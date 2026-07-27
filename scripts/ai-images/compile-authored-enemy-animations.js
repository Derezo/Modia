#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { APPROVED_STATUS } = require('./lib/authoredPlayerAnimationCompiler');
const { DEFAULT_SPEC_DIRECTORY, compileAuthoredEnemy } = require('./lib/authoredEnemyAnimationCompiler');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; const value = () => { const result = argv[++i]; if (!result || result.startsWith('--')) throw new Error(`${arg} requires a value`); return result; };
    if (arg === '--id') options.id = value();
    else if (arg === '--biome') options.biome = value();
    else if (arg === '--spec') options.specPath = path.resolve(value());
    else if (arg === '--project-root') options.projectRoot = path.resolve(value());
    else if (arg === '--all-approved') options.allApproved = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--update-pins') options.updatePins = true;
    else if (arg === '--approve') options.approve = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.allApproved && (!options.id || !options.biome)) throw new Error('--biome and --id, or --all-approved, are required');
  if (options.allApproved && !options.check) throw new Error('--all-approved requires --check');
  if (options.check && options.updatePins) throw new Error('--check and --update-pins are mutually exclusive');
  if (options.approve && !options.updatePins) throw new Error('--approve requires --update-pins');
  if (options.approve && options.check) throw new Error('--approve and --check are mutually exclusive');
  if (options.approve && options.allApproved) throw new Error('--approve cannot be used with --all-approved');
  return options;
}
async function compileAll(options) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../..'));
  const root = path.join(projectRoot, DEFAULT_SPEC_DIRECTORY);
  const results = [];
  for (const biomeEntry of (await fs.promises.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = path.join(root, biomeEntry.name);
    for (const file of (await fs.promises.readdir(directory)).filter(name => name.endsWith('.json')).sort()) {
      const spec = JSON.parse(await fs.promises.readFile(path.join(directory, file), 'utf8'));
      if (APPROVED_STATUS.test(String(spec.status || ''))) results.push(await compileAuthoredEnemy({ ...options, allApproved: undefined, biome: spec.biome, id: spec.id }));
    }
  }
  if (!results.length) return { ok: true, check: true, targets: 0, results: [], issues: [] };
  return { ok: results.every(value => value.ok), check: true, targets: results.length, results, issues: results.flatMap(value => value.issues.map(issue => `${value.biome}/${value.id}: ${issue}`)) };
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log('Usage: npm run ai:compile:authored-enemy-animations -- --biome <biome> --id <enemy_id> [--update-pins --approve] [--force|--check]'); return; }
  const result = options.allApproved ? await compileAll(options) : await compileAuthoredEnemy(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`${result.check ? 'Verified' : 'Compiled'} ${options.allApproved ? `${result.targets} authored enemies` : `${result.biome}/${result.id}`}.`);
  else for (const issue of result.issues) console.error(`- ${issue}`);
  if (!result.ok) process.exitCode = 1;
  return result;
}
if (require.main === module) main().catch(error => { console.error(`Enemy compilation failed: ${error.message}`); process.exitCode = 1; });
module.exports = { compileAll, main, parseArgs };
