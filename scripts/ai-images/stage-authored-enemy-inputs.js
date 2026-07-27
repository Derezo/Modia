#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { const result = argv[++i]; if (!result || result.startsWith('--')) throw new Error(`${arg} requires a value`); return result; };
    if (arg === '--id') options.id = value();
    else if (arg === '--biome') options.biome = value();
    else if (arg === '--all') options.all = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.biome) throw new Error('--biome is required');
  if (!options.help && Boolean(options.id) === Boolean(options.all)) throw new Error('provide exactly one of --id or --all');
  return options;
}
function projectPath(root, candidate) {
  const resolved = path.resolve(root, candidate);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`path escapes project root: ${candidate}`);
  return resolved;
}
async function stageEnemy(root, options) {
  const specPath = path.join(root, 'ai-image-metadata/characters/enemy-authored-animations', options.biome, `${options.id}.json`);
  const spec = JSON.parse(await fs.promises.readFile(specPath, 'utf8'));
  if (spec.id !== options.id || spec.biome !== options.biome) throw new Error('spec identity does not match arguments');
  const inputs = ['identity', 'style'].map(kind => ({
    kind,
    origin: projectPath(root, spec.inputs[kind].origin),
    staged: projectPath(root, spec.inputs[kind].staged)
  }));
  if (!options.force) {
    const existing = inputs.find(input => fs.existsSync(input.staged));
    if (existing) throw new Error(`${path.relative(root, existing.staged)} exists; use --force`);
  }
  for (const input of inputs) {
    await fs.promises.mkdir(path.dirname(input.staged), { recursive: true });
    await fs.promises.copyFile(input.origin, input.staged);
    console.log(`Staged ${input.kind} authority: ${path.relative(root, input.staged)}`);
  }
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log('Usage: npm run ai:stage:authored-enemy-inputs -- --biome <biome> (--id <enemy_id>|--all) [--force]'); return; }
  const root = path.resolve(__dirname, '../..');
  let ids = [options.id];
  if (options.all) {
    const registryPath = path.join(root, 'ai-image-metadata/characters/enemies', `${options.biome}.json`);
    const registry = JSON.parse(await fs.promises.readFile(registryPath, 'utf8'));
    const aliasPath = path.join(root, 'ai-image-metadata/characters/enemy-authored-identity-aliases.json');
    const aliasRegistry = JSON.parse(await fs.promises.readFile(aliasPath, 'utf8'));
    ids = [
      ...(registry.enemies || []).map(enemy => enemy.id),
      ...(aliasRegistry.aliases || []).filter(alias => alias.biome === options.biome).map(alias => alias.id)
    ];
    if (!ids.length) throw new Error(`${options.biome} has no configured enemies`);
  }
  for (const id of ids) await stageEnemy(root, { ...options, all: undefined, id });
  return { ok: true, biome: options.biome, targets: ids.length };
}
if (require.main === module) main().catch(error => { console.error(`Enemy input staging failed: ${error.message}`); process.exitCode = 1; });
module.exports = { main, parseArgs, stageEnemy };
