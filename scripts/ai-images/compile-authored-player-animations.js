#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  APPROVED_STATUS,
  DEFAULT_SPEC_DIRECTORY,
  compileAuthoredVariant
} = require('./lib/authoredPlayerAnimationCompiler');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--id') options.id = argv[++index];
    else if (argument.startsWith('--id=')) options.id = argument.slice('--id='.length);
    else if (argument === '--all-approved') options.allApproved = true;
    else if (argument === '--spec') options.specPath = path.resolve(argv[++index]);
    else if (argument.startsWith('--spec=')) options.specPath = path.resolve(argument.slice('--spec='.length));
    else if (argument === '--project-root') options.projectRoot = path.resolve(argv[++index]);
    else if (argument.startsWith('--project-root=')) options.projectRoot = path.resolve(argument.slice('--project-root='.length));
    else if (argument === '--registry') options.registryPath = path.resolve(argv[++index]);
    else if (argument.startsWith('--registry=')) options.registryPath = path.resolve(argument.slice('--registry='.length));
    else if (argument === '--check') options.check = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--update-pins') options.updatePins = true;
    else if (argument === '--approve') options.approve = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.id && !options.allApproved) throw new Error('--id or --all-approved is required');
  if (options.id && options.allApproved) throw new Error('--id and --all-approved are mutually exclusive');
  if (options.allApproved && !options.check) throw new Error('--all-approved is read-only and requires --check');
  if (options.allApproved && options.specPath) throw new Error('--spec cannot be combined with --all-approved');
  if (options.check && options.updatePins) throw new Error('--check and --update-pins are mutually exclusive');
  if (options.approve && !options.updatePins) throw new Error('--approve requires --update-pins');
  if (options.approve && options.check) throw new Error('--approve and --check are mutually exclusive');
  if (options.approve && options.allApproved) throw new Error('--approve cannot be used with --all-approved');
  return options;
}

function printHelp() {
  console.log(`Metadata-driven authored player animation compiler

Usage:
  node scripts/ai-images/compile-authored-player-animations.js --id <race_gender_class> [options]

Options:
  --check          Recompile in memory and verify pinned sources and canonical outputs
  --all-approved   With --check, verify every spec whose status starts with "approved"
  --force          Replace existing canonical reference and animation strips
  --update-pins    Refresh deterministic source/prompt/output provenance in the identity spec
  --approve        Mark the spec approved and set approvedAt; requires --update-pins
  --spec <path>    Override the default per-identity authored animation spec
  --registry <p>   Override player-variants.json
  --project-root   Override the project root (primarily for isolated tests)
  --json           Print machine-readable output
  --help           Show this help

Image generation is intentionally outside this deterministic compiler. Accepted
RGBA source atlases live in a tracked metadata directory and are hash-pinned by
--update-pins; compilation only extracts poses, normalizes them uniformly, and
assembles the existing 64x512 lossless WebP runtime contract.`);
}

async function compileAllApproved(options) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../..'));
  const specDirectory = path.join(projectRoot, DEFAULT_SPEC_DIRECTORY);
  const entries = (await fs.promises.readdir(specDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .sort((first, second) => first.name.localeCompare(second.name));
  const approved = [];
  for (const entry of entries) {
    const spec = JSON.parse(await fs.promises.readFile(path.join(specDirectory, entry.name), 'utf8'));
    if (APPROVED_STATUS.test(String(spec.status || ''))) approved.push(spec.id);
  }
  if (approved.length === 0) throw new Error('no approved authored player animation specs were found');

  const results = [];
  for (const id of approved) results.push(await compileAuthoredVariant({ ...options, id, allApproved: undefined }));
  return {
    ok: results.every(result => result.ok),
    check: true,
    targets: results.length,
    ids: approved,
    results,
    issues: results.flatMap(result => result.issues.map(issue => `${result.id}: ${issue}`))
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }
  const result = options.allApproved
    ? await compileAllApproved(options)
    : await compileAuthoredVariant(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) {
    const verb = result.check ? 'Verified' : 'Compiled';
    const subject = options.allApproved
      ? `${result.targets} approved authored player animation identities`
      : `authored player animation identity ${result.id}`;
    console.log(`${verb} ${subject}.`);
    for (const generated of result.generated || []) console.log(`- ${generated}`);
  } else {
    for (const issue of result.issues) console.error(`- ${issue}`);
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Authored player animation compilation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { compileAllApproved, main, parseArgs };
