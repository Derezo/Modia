#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  CLASS_SIGNATURES,
  compileIdentities
} = require('./lib/playerIdentityFallbackCompiler');

function appendList(target, rawValue) {
  if (rawValue === undefined) throw new Error('Missing value after --id.');
  for (const value of String(rawValue).split(',')) {
    const normalized = value.trim().toLowerCase();
    if (normalized && !target.includes(normalized)) target.push(normalized);
  }
}

function parseArgs(argv) {
  const options = { ids: [] };
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
    else if (argument === '--project-root') options.projectRoot = path.resolve(argv[++index]);
    else if (argument.startsWith('--project-root=')) options.projectRoot = path.resolve(argument.slice('--project-root='.length));
    else if (argument === '--metadata') options.registryPath = path.resolve(argv[++index]);
    else if (argument.startsWith('--metadata=')) options.registryPath = path.resolve(argument.slice('--metadata='.length));
    else if (argument === '--provenance') options.provenancePath = path.resolve(argv[++index]);
    else if (argument.startsWith('--provenance=')) options.provenancePath = path.resolve(argument.slice('--provenance='.length));
    else throw new Error(`Unknown argument: ${argument}`);
  }

  const scopes = [options.all, options.sample, options.ids.length > 0].filter(Boolean).length;
  if (!options.help && scopes !== 1) throw new Error('Choose exactly one scope: --id <identity>, --sample, or --all.');
  if (options.check && options.force) throw new Error('--check and --force cannot be combined.');
  return options;
}

function printHelp() {
  console.log(`Deterministic canonical player identity fallback compiler

Usage:
  node scripts/ai-images/compile-player-identity-fallbacks.js --id <race_gender_class> [options]
  node scripts/ai-images/compile-player-identity-fallbacks.js --sample [options]
  node scripts/ai-images/compile-player-identity-fallbacks.js --all [options]

Safety:
  No scope is implicit. Bulk compilation requires the explicit --all gate.
  Existing canonical references are preserved unless --force is supplied.

Options:
  --id <id[,id]>            Compile one or more explicit identities
  --sample                  Compile one preferred missing sample (dwarf_female_chemist first)
  --all                     Explicitly opt in to all 300 registry identities
  --check                   Validate selected canonical references and provenance; write nothing
  --force                   Deterministically replace selected existing references
  --project-root <path>     Override repository root (primarily for isolated tests)
  --metadata <path>         Override player-variants.json
  --provenance <path>       Override fallback provenance JSON
  --json                    Print the result as JSON
  --help                    Show this help

Supported class signatures (${Object.keys(CLASS_SIGNATURES).length}):
  ${Object.keys(CLASS_SIGNATURES).join(', ')}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }
  const result = await compileIdentities(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = result.check ? 'verified' : 'processed';
    console.log(`Player identity fallback: ${verb} ${result.targets} target(s).`);
    if (result.generated.length) console.log(`Generated: ${result.generated.join(', ')}`);
    if (result.skipped.length) console.log(`Preserved existing: ${result.skipped.join(', ')}`);
    if (result.verified.length) console.log(`Verified: ${result.verified.join(', ')}`);
    console.log(`Provenance: ${result.provenance}`);
    for (const issue of result.issues) console.error(`- ${issue}`);
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Player identity fallback failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { appendList, main, parseArgs };
