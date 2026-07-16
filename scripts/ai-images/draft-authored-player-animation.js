#!/usr/bin/env node
'use strict';

const { draftAuthoredVariant } = require('./lib/authoredPlayerAnimationDraft');

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function assignedValue(argument, flag) {
  const value = argument.slice(`${flag}=`.length);
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function setIdentity(options, value) {
  if (options.id !== undefined) throw new Error('--id may only be provided once');
  options.id = value;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--id') {
      setIdentity(options, takeValue(argv, index, argument));
      index += 1;
    } else if (argument.startsWith('--id=')) setIdentity(options, assignedValue(argument, '--id'));
    else if (argument === '--profile') {
      options.profile = takeValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('--profile=')) options.profile = assignedValue(argument, '--profile');
    else if (argument === '--template') {
      options.templatePath = takeValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('--template=')) options.templatePath = assignedValue(argument, '--template');
    else if (argument === '--registry') {
      options.registryPath = takeValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('--registry=')) options.registryPath = assignedValue(argument, '--registry');
    else if (argument === '--output') {
      options.outputPath = takeValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('--output=')) options.outputPath = assignedValue(argument, '--output');
    else if (argument === '--project-root') {
      options.projectRoot = takeValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith('--project-root=')) options.projectRoot = assignedValue(argument, '--project-root');
    else if (argument === '--check') options.check = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.id) {
    throw new Error('--id is required; bulk drafting is intentionally unsupported');
  }
  if (options.check && options.force) throw new Error('--check and --force are mutually exclusive');
  return options;
}

function printHelp() {
  console.log(`Metadata-driven authored player animation draft scaffold

Usage:
  node scripts/ai-images/draft-authored-player-animation.js --id <race_gender_class> [options]

Options:
  --profile <id|path>  Profile id (defaults to <class>_v1) or project-relative JSON path
  --template <path>    Override the project-relative authored pose template
  --registry <path>    Override the project-relative player-variants registry
  --output <path>      Override the project-relative draft spec path
  --project-root <p>   Override the project root (primarily for isolated tests)
  --check              Verify the existing draft is the exact deterministic render
  --force              Replace an existing draft spec; never replaces source images
  --json               Print a machine-readable result
  --help                Show this help

Exactly one --id is required. This command only writes metadata: it does not copy
identity/style inputs, invoke image generation, alter accepted sources, or compile
runtime strips.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }
  const result = await draftAuthoredVariant(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) {
    const verb = result.check ? 'Verified' : 'Drafted';
    console.log(`${verb} authored animation metadata for ${result.id}: ${result.output}`);
    console.log('No images were generated or changed.');
  } else {
    for (const issue of result.issues) console.error(`- ${issue}`);
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Authored player animation drafting failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
