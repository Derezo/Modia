import path from 'node:path';
import {
  approveTemplate,
  defaultProjectRoot,
  draftTemplate,
  inventoryTemplates,
  pinTemplateCompiler,
  stageTemplate
} from './source-template-lifecycle.mjs';

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function setOnce(options, key, value, flag) {
  if (options[key] !== undefined) throw new Error(`${flag} may only be provided once`);
  options[key] = value;
}

export function parseTemplateArgs(argv, {
  source = false,
  review = false,
  inventory = false,
  check = false,
  force = false,
  compiler = false
} = {}) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    const readValue = () => {
      if (inlineValue !== undefined) {
        if (inlineValue === '') throw new Error(`${flag} requires a value`);
        return inlineValue;
      }
      const value = takeValue(argv, index, flag);
      index += 1;
      return value;
    };

    if (flag === '--theme') setOnce(options, 'theme', readValue(), flag);
    else if (flag === '--template') setOnce(options, 'template', readValue(), flag);
    else if (flag === '--project-root') setOnce(options, 'projectRoot', readValue(), flag);
    else if (flag === '--source' && source) setOnce(options, 'source', readValue(), flag);
    else if (flag === '--reviewer' && review) setOnce(options, 'reviewer', readValue(), flag);
    else if (flag === '--decision' && review) setOnce(options, 'decision', readValue(), flag);
    else if (flag === '--compiler-full-hash' && compiler) {
      setOnce(options, 'compilerFullHash', readValue(), flag);
    }
    else if (flag === '--check' && check && inlineValue === undefined) options.check = true;
    else if (flag === '--force' && force && inlineValue === undefined) options.force = true;
    else if (flag === '--json' && inlineValue === undefined) options.json = true;
    else if ((flag === '--help' || flag === '-h') && inlineValue === undefined) options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.projectRoot !== undefined) options.projectRoot = path.resolve(options.projectRoot);
  if (!options.help && !inventory) {
    if (!options.theme) throw new Error('--theme is required');
    if (!options.template) throw new Error('--template is required');
  }
  if (!options.help && source && !options.source) throw new Error('--source is required');
  if (!options.help && compiler && !options.compilerFullHash) {
    throw new Error('--compiler-full-hash is required');
  }
  if (!options.help && review) {
    if (!options.reviewer) throw new Error('--reviewer is required');
    if (!options.decision) throw new Error('--decision is required');
  }
  if (options.check && options.force) throw new Error('--check and --force are mutually exclusive');
  return options;
}

function emitResult(result, json, successMessage) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(successMessage(result));
}

export async function runDraft(argv = process.argv.slice(2)) {
  const options = parseTemplateArgs(argv, { check: true, force: true });
  if (options.help) {
    console.log(`Usage: node scripts/battle-maps/draft-template.mjs --theme <theme> --template <id> [--check|--force] [--json] [--project-root <path>]

Deterministically creates or checks the tracked semantic source-template sidecar.
This command never creates, stages, or approves image binaries.`);
    return { ok: true, help: true };
  }
  const result = await draftTemplate(options);
  emitResult(result, options.json, value => (
    `${value.changed ? 'Drafted' : 'Verified'} ${options.theme}/${options.template} (${value.status}); no image or approval changed.`
  ));
  return result;
}

export async function runStage(argv = process.argv.slice(2)) {
  const options = parseTemplateArgs(argv, { source: true, force: true });
  if (options.help) {
    console.log(`Usage: node scripts/battle-maps/stage-template.mjs --theme <theme> --template <id> --source <project-relative.png|webp> [--force] [--json] [--project-root <path>]

Validates and atomically copies a supplied image or reviewed generated candidate
to the canonical ignored source path. This command never approves a template.`);
    return { ok: true, help: true };
  }
  const result = await stageTemplate(options);
  emitResult(result, options.json, value => (
    `${value.changed ? 'Staged' : 'Verified staged'} ${options.theme}/${options.template}: ${value.sourceImage.path}. Approval is unchanged.`
  ));
  return result;
}

export async function runApprove(argv = process.argv.slice(2)) {
  const options = parseTemplateArgs(argv, { review: true, force: true });
  if (options.help) {
    console.log(`Usage: node scripts/battle-maps/approve-template.mjs --theme <theme> --template <id> --reviewer <identity> --decision approved [--force] [--json] [--project-root <path>]

Rechecks the staged image and frozen prompt pins, then records the supplied human
review. No image generation, staging, blueprint generation, or compilation occurs.`);
    return { ok: true, help: true };
  }
  const result = await approveTemplate(options);
  emitResult(result, options.json, value => (
    `${value.changed ? 'Approved' : 'Verified approval for'} ${options.theme}/${options.template} by ${value.review.reviewer}.`
  ));
  return result;
}

export async function runPinCompiler(argv = process.argv.slice(2)) {
  const options = parseTemplateArgs(argv, { compiler: true });
  if (options.help) {
    console.log(`Usage: node scripts/battle-maps/pin-template-compiler.mjs --theme <theme> --template <id> --compiler-full-hash <sha256:...> [--json] [--project-root <path>]

Computes and verifies the exact current compiler source-set identity, then
atomically records the explicitly supplied matching fullHash on a staged,
unapproved template. Existing different and approved pins are immutable.`);
    return { ok: true, help: true };
  }
  const result = await pinTemplateCompiler(options);
  emitResult(result, options.json, value => (
    `${value.changed ? 'Pinned' : 'Verified compiler pin for'} ${options.theme}/${options.template}: ${value.compilerFullHash}.`
  ));
  return result;
}

export async function runInventory(argv = process.argv.slice(2)) {
  const options = parseTemplateArgs(argv, { inventory: true });
  if (options.help) {
    console.log('Usage: node scripts/battle-maps/inventory-template-sources.mjs [--json] [--project-root <path>]');
    return { ok: true, help: true };
  }
  const result = await inventoryTemplates({
    projectRoot: options.projectRoot ?? defaultProjectRoot()
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  return result;
}

export function reportCliFailure(label, error) {
  console.error(`${label} failed: ${error.message}`);
  process.exitCode = 1;
}
