#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  SUPPORTED_ANIMATIONS,
  compileTargets
} = require('./lib/playerAnimationCompiler');

function appendList(target, rawValue) {
  for (const value of String(rawValue).split(',')) {
    const normalized = value.trim().toLowerCase();
    if (normalized && !target.includes(normalized)) target.push(normalized);
  }
}

function parseArgs(argv) {
  const options = { ids: [], animations: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') options.all = true;
    else if (argument === '--sample') options.sample = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--check') options.check = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--id') appendList(options.ids, argv[++index]);
    else if (argument.startsWith('--id=')) appendList(options.ids, argument.slice('--id='.length));
    else if (argument === '--animation' || argument === '--animations') appendList(options.animations, argv[++index]);
    else if (argument.startsWith('--animation=')) appendList(options.animations, argument.slice('--animation='.length));
    else if (argument.startsWith('--animations=')) appendList(options.animations, argument.slice('--animations='.length));
    else if (argument === '--project-root') options.projectRoot = path.resolve(argv[++index]);
    else if (argument.startsWith('--project-root=')) options.projectRoot = path.resolve(argument.slice('--project-root='.length));
    else if (argument === '--metadata') options.registryPath = path.resolve(argv[++index]);
    else if (argument.startsWith('--metadata=')) options.registryPath = path.resolve(argument.slice('--metadata='.length));
    else throw new Error(`Unknown argument: ${argument}`);
  }

  const scopes = [options.all, options.sample, options.ids.length > 0].filter(Boolean).length;
  if (!options.help && scopes !== 1) {
    throw new Error('Choose exactly one scope: --id <identity>, --sample, or --all.');
  }
  return options;
}

function printHelp() {
  console.log(`Deterministic player animation fallback compiler

Usage:
  node scripts/ai-images/compile-player-animations.js --id <race_gender_class> [options]
  node scripts/ai-images/compile-player-animations.js --sample [options]
  node scripts/ai-images/compile-player-animations.js --all [options]

Options:
  --animation <name[,name]>  Limit animation types (${SUPPORTED_ANIMATIONS.join(', ')})
  --check                    Validate selected canonical strips and metadata; write nothing
  --force                    Replace an existing canonical strip after recompiling it
  --sample                   Select the first available full-body identity reference and one missing strip
  --all                      Explicitly opt in to every registry variant (never the default)
  --project-root <path>      Override the repository root (primarily for isolated tests)
  --metadata <path>          Override player-variants.json
  --json                     Print the result as JSON
  --help                     Show this help

Existing canonical strips are preserved unless --force is supplied.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }

  const result = await compileTargets(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = result.check ? 'verified' : 'processed';
    console.log(`Player animation fallback: ${verb} ${result.targets} target(s).`);
    if (result.generated.length) console.log(`Generated: ${result.generated.join(', ')}`);
    if (result.skipped.length) console.log(`Preserved existing: ${result.skipped.join(', ')}`);
    if (result.approvedGolden.length) console.log(`Approved golden exceptions: ${result.approvedGolden.join(', ')}`);
    if (result.verified.length) console.log(`Verified: ${result.verified.join(', ')}`);
    for (const issue of result.issues) console.error(`- ${issue}`);
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Player animation fallback failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
