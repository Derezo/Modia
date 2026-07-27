#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_AUTHORED_ALIASES,
  draftAuthoredEnemy
} = require('./lib/authoredEnemyAnimationDraft');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { const result = argv[++i]; if (!result || result.startsWith('--')) throw new Error(`${arg} requires a value`); return result; };
    if (arg === '--id') options.id = value();
    else if (arg === '--biome') options.biome = value();
    else if (arg === '--all') options.all = true;
    else if (arg === '--profile') options.profilePath = value();
    else if (arg === '--template') options.templatePath = value();
    else if (arg === '--registry') options.registryPath = value();
    else if (arg === '--output') options.outputPath = value();
    else if (arg === '--project-root') options.projectRoot = value();
    else if (arg === '--check') options.check = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.biome) throw new Error('--biome is required');
  if (!options.help && Boolean(options.id) === Boolean(options.all)) throw new Error('provide exactly one of --id or --all');
  if (options.all && options.outputPath) throw new Error('--output cannot be used with --all');
  return options;
}
async function biomeEnemyIds(options) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../..'));
  const registryPath = path.resolve(projectRoot, options.registryPath || `ai-image-metadata/characters/enemies/${options.biome}.json`);
  const registry = JSON.parse(await fs.promises.readFile(registryPath, 'utf8'));
  if (registry.biome !== options.biome) throw new Error(`registry biome ${registry.biome} does not match ${options.biome}`);
  const aliasPath = path.resolve(projectRoot, DEFAULT_AUTHORED_ALIASES);
  const aliasRegistry = JSON.parse(await fs.promises.readFile(aliasPath, 'utf8'));
  const ids = [
    ...(registry.enemies || []).map(enemy => enemy.id),
    ...(aliasRegistry.aliases || []).filter(alias => alias.biome === options.biome).map(alias => alias.id)
  ];
  if (!ids.length) throw new Error(`${options.biome} has no configured enemies`);
  return ids;
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: npm run ai:draft:authored-enemy-animation -- --biome <biome> (--id <enemy_id>|--all) [--force|--check|--json]');
    return;
  }
  const ids = options.all ? await biomeEnemyIds(options) : [options.id];
  const results = [];
  for (const id of ids) {
    const result = await draftAuthoredEnemy({ ...options, all: undefined, id });
    results.push(result);
    if (!options.json) console.log(`${result.check ? 'Verified' : 'Drafted'} ${result.biome}/${result.id}: ${result.output}`);
  }
  const summary = { ok: results.every(result => result.ok), biome: options.biome, targets: results.length, results };
  if (options.json) console.log(JSON.stringify(options.all ? summary : results[0], null, 2));
  if (!summary.ok) process.exitCode = 1;
  return options.all ? summary : results[0];
}
if (require.main === module) main().catch(error => { console.error(`Enemy draft failed: ${error.message}`); process.exitCode = 1; });
module.exports = { biomeEnemyIds, main, parseArgs };
