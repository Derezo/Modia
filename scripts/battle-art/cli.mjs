#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  archiveCurrentRelease,
  approveCandidate,
  assertReviewReason,
  auditBattleArt,
  checkBattleArt,
  compileApproved,
  recordCandidateReview,
  reportReadinessMatrix,
  reviseFamily,
  scaffoldReadinessDescriptors,
  writeDraft,
  writeInventory,
  writePreview
} from './lifecycle.mjs';
import {
  generateBattleArt,
  parseGenerateArgs
} from './generate.mjs';
import {
  normalizeCandidates
} from './normalize.mjs';

function takeValue(argv, index, flag, inline) {
  const value = inline ?? argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return { value, consumed: inline === null ? 1 : 0 };
}

function parseOptions(argv, allowed) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? null : argument.slice(equals + 1);
    const definition = allowed[flag];
    if (!definition) throw new Error(`unknown argument ${argument}`);
    if (seen.has(flag) && !definition.repeat) throw new Error(`${flag} may only be provided once`);
    seen.add(flag);
    if (definition.boolean) {
      if (inline !== null) throw new Error(`${flag} does not take a value`);
      options[definition.key] = true;
      continue;
    }
    const result = takeValue(argv, index, flag, inline);
    index += result.consumed;
    const parsed = definition.transform
      ? definition.transform(result.value, flag)
      : result.value;
    if (definition.repeat) {
      options[definition.key] = [...(options[definition.key] ?? []), parsed];
    } else {
      options[definition.key] = parsed;
    }
  }
  return options;
}

const COMMON = Object.freeze({
  '--project-root': { key: 'root', transform: value => path.resolve(value) },
  '--json': { key: 'json', boolean: true }
});

function parseInteger(value, flag) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 4096) throw new Error(`${flag} must be <= 4096`);
  return parsed;
}

function parseHeightDelta(value, flag) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${flag} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 64) {
    throw new Error(`${flag} must be between 0 and 64`);
  }
  return parsed;
}

function parseSurfaceVariant(value, flag) {
  if (!/^[0-7]$/.test(value)) {
    throw new Error(`${flag} must be an integer from 0 through 7`);
  }
  return Number(value);
}

function parseReviewReason(value, flag) {
  return assertReviewReason(value, flag);
}

const SELECTION = Object.freeze({
  '--theme': { key: 'theme' },
  '--ecology-profile': { key: 'ecologyProfile' },
  '--tier': { key: 'tier', transform: parseInteger },
  '--category': { key: 'category' },
  '--surface-variant': {
    key: 'surfaceVariant',
    transform: parseSurfaceVariant
  },
  '--family': { key: 'families', repeat: true }
});

export function parseCommand(argv = process.argv.slice(2)) {
  const [command, ...argumentsList] = argv;
  if (!command || command === '--help' || command === '-h') return { command: 'help', options: {} };
  if (command === 'generate') {
    const json = argumentsList.includes('--json');
    const generateArgs = argumentsList.filter(argument => argument !== '--json');
    return { command, options: { ...parseGenerateArgs(generateArgs), json } };
  }
  if (command === 'draft') {
    const options = parseOptions(argumentsList, {
      ...COMMON,
      '--theme': { key: 'theme' },
      '--category': { key: 'category' },
      '--family': { key: 'id' },
      '--family-group': { key: 'familyGroup' },
      '--variant': { key: 'variantId' },
      '--direction': { key: 'direction' },
      '--route-topology': { key: 'routeTopology' },
      '--surface-variant': {
        key: 'surfaceVariant',
        transform: parseSurfaceVariant
      },
      '--ecology-profile': { key: 'ecologyProfile' },
      '--art-direction': { key: 'regionalArtDirection' },
      '--tier': { key: 'tierBands', transform: parseInteger, repeat: true },
      '--height-delta': {
        key: 'heightDeltas',
        transform: parseHeightDelta,
        repeat: true
      },
      '--width': { key: 'width', transform: parseInteger },
      '--height': { key: 'height', transform: parseInteger },
      '--check': { key: 'check', boolean: true },
      '--force': { key: 'force', boolean: true }
    });
    for (const key of ['theme', 'category', 'id']) {
      if (!options[key]) throw new Error(`--${key === 'id' ? 'family' : key} is required`);
    }
    if (options.check && options.force) throw new Error('--check and --force are mutually exclusive');
    return { command, options };
  }
  if (command === 'approve') {
    const options = parseOptions(argumentsList, {
      ...COMMON,
      '--theme': { key: 'theme' },
      '--family': { key: 'family' },
      '--reviewer': { key: 'reviewer' },
      '--decision': { key: 'decision' },
      '--reason': { key: 'reason', transform: parseReviewReason }
    });
    for (const key of ['theme', 'family', 'reviewer', 'decision', 'reason']) {
      if (!options[key]) throw new Error(`--${key} is required`);
    }
    if (options.decision !== 'approved') {
      throw new Error('--decision approved is required');
    }
    return { command, options };
  }
  if (command === 'review') {
    const options = parseOptions(argumentsList, {
      ...COMMON,
      '--theme': { key: 'theme' },
      '--family': { key: 'family' },
      '--reviewer': { key: 'reviewer' },
      '--decision': { key: 'decision' },
      '--reason': { key: 'reason', transform: parseReviewReason }
    });
    for (const key of ['theme', 'family', 'reviewer', 'decision', 'reason']) {
      if (!options[key]) throw new Error(`--${key} is required`);
    }
    if (!['approved', 'rejected'].includes(options.decision)) {
      throw new Error('--decision must be approved or rejected');
    }
    return { command, options };
  }
  if (command === 'revise') {
    const options = parseOptions(argumentsList, {
      ...COMMON,
      '--theme': { key: 'theme' },
      '--family': { key: 'family' }
    });
    for (const key of ['theme', 'family']) {
      if (!options[key]) throw new Error(`--${key} is required`);
    }
    return { command, options };
  }
  if (command === 'preview') {
    return {
      command,
      options: parseOptions(argumentsList, {
        ...COMMON,
        ...SELECTION,
        '--output': { key: 'output' }
      })
    };
  }
  if (command === 'normalize') {
    return {
      command,
      options: parseOptions(argumentsList, {
        ...COMMON,
        ...SELECTION,
        '--check': { key: 'check', boolean: true }
      })
    };
  }
  if (command === 'compile') {
    return {
      command,
      options: parseOptions(argumentsList, {
        ...COMMON,
        '--check': { key: 'check', boolean: true }
      })
    };
  }
  if (command === 'inventory') {
    return {
      command,
      options: parseOptions(argumentsList, {
        ...COMMON,
        ...SELECTION,
        '--check': { key: 'check', boolean: true }
      })
    };
  }
  if (command === 'archive') {
    return { command, options: parseOptions(argumentsList, COMMON) };
  }
  if (command === 'matrix') {
    return {
      command,
      options: parseOptions(argumentsList, {
        ...COMMON,
        ...SELECTION,
        '--plan': { key: 'plan' },
        '--metadata-only': { key: 'metadataOnly', boolean: true }
      })
    };
  }
  if (command === 'scaffold') {
    const options = parseOptions(argumentsList, {
      ...COMMON,
      ...SELECTION,
      '--plan': { key: 'plan' },
      '--check': { key: 'check', boolean: true },
      '--force': { key: 'force', boolean: true }
    });
    for (const key of ['theme', 'ecologyProfile', 'tier', 'category']) {
      if (!options[key]) {
        throw new Error(
          `--${key === 'ecologyProfile' ? 'ecology-profile' : key} is required`
        );
      }
    }
    if (options.check && options.force) {
      throw new Error('--check and --force are mutually exclusive');
    }
    return { command, options };
  }
  if (command === 'audit') {
    return {
      command,
      options: parseOptions(argumentsList, {
        ...COMMON,
        ...SELECTION,
        '--plan': { key: 'plan' }
      })
    };
  }
  if (command === 'check') {
    return { command, options: parseOptions(argumentsList, COMMON) };
  }
  throw new Error(`unknown battle-art command ${command}`);
}

function help() {
  return `Tracked Battle Map V3 art lifecycle

Commands:
  audit
  matrix [--plan <tracked.json>] [--theme <theme> --ecology-profile <id> --tier n --category <category>] [--metadata-only]
  scaffold --theme <theme> --ecology-profile <id> --tier n --category <category> [--family <id> ...] [--check|--force]
  draft --theme <theme> --category <category> --family <id> [variant capability flags] [--art-direction <text>] [--width n --height n --check|--force]
  generate [selection flags] [--family <id> ...] [--dry-run|--resume|--force] [--keep-going] [--concurrency 1-4]
  generate --family <id> --recover --timeout <original-seconds>
  normalize [selection flags] [--family <id> ...] [--check]
  preview [selection flags] [--family <id> ...] [--output <tracked.html>]
  review --theme <theme> --family <id> --reviewer <identity> --decision approved|rejected --reason <rationale>
  approve --theme <theme> --family <id> --reviewer <identity> --decision approved --reason <rationale>
  revise --theme <theme> --family <id>
  compile [--check]
  archive
  check
  inventory [selection flags] [--check]

Every command accepts --project-root for isolated tests and --json for machine output.
Generation only creates review candidates. Approval never compiles; compilation never approves.`;
}

export async function main(argv = process.argv.slice(2), dependencies) {
  const parsed = parseCommand(argv);
  if (parsed.command === 'help') {
    console.log(help());
    return { ok: true, help: true };
  }
  const { json, root, ...options } = parsed.options;
  const common = { ...options, root };
  let result;
  if (parsed.command === 'audit') result = await auditBattleArt(common);
  else if (parsed.command === 'matrix') result = await reportReadinessMatrix(common);
  else if (parsed.command === 'scaffold') {
    result = await scaffoldReadinessDescriptors(common);
  }
  else if (parsed.command === 'draft') result = await writeDraft(common);
  else if (parsed.command === 'generate') {
    result = await generateBattleArt({ ...options, projectRoot: root }, dependencies);
  } else if (parsed.command === 'normalize') result = await normalizeCandidates(common);
  else if (parsed.command === 'preview') result = await writePreview(common);
  else if (parsed.command === 'review') result = await recordCandidateReview(common);
  else if (parsed.command === 'approve') result = await approveCandidate(common);
  else if (parsed.command === 'revise') result = await reviseFamily(common);
  else if (parsed.command === 'compile') result = await compileApproved(common);
  else if (parsed.command === 'archive') result = await archiveCurrentRelease(common);
  else if (parsed.command === 'check') result = await checkBattleArt(common);
  else if (parsed.command === 'inventory') result = await writeInventory(common);
  else throw new Error(`unimplemented command ${parsed.command}`);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${parsed.command} completed: ${JSON.stringify(result)}`);
  if (result?.ok === false) process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Battle-art lifecycle failed: ${error.message}`);
    process.exitCode = 1;
  });
}
