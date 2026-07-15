const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CANONICAL_GENERATOR = path.join(__dirname, 'generate-isometric-tiles.js');
const CANONICAL_VALIDATOR = path.join(__dirname, 'validate-isometric-tiles.js');

const TILE_CATEGORIES = new Set(['floors', 'walls', 'slopes']);
const TILE_BIOMES = new Set(['forest', 'cave', 'mountain', 'bridge', 'castle']);
const AI_ONLY_OPTIONS = new Map([
  ['--huggingface', false],
  ['--hf', false],
  ['--local', false],
  ['--lora', true],
  ['--seed', true],
  ['--seed-mode', true],
  ['--fixed-seed', true],
  ['--delay', true],
  ['--limit', true],
  ['--variants', true],
  ['--batch', true]
]);

function optionName(argument) {
  return argument.split('=', 1)[0];
}

function readOptionValue(argv, index, option) {
  const argument = argv[index];
  if (argument.includes('=')) {
    const value = argument.slice(argument.indexOf('=') + 1);
    if (!value) throw new Error(`${option} requires a value`);
    return { value, consumed: 0 };
  }

  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
  return { value, consumed: 1 };
}

/**
 * Translate the retired AI tile CLI into the deterministic compiler contract.
 * AI-only controls are rejected instead of being silently ignored.
 */
function translateLegacyAiTileArgs(argv) {
  const translated = [];
  const valueOptions = new Set(['--biome', '--category', '--key']);
  const booleanOptions = new Set([
    '--dry-run', '--force', '--queue', '--backup', '--update-metadata',
    '--prune', '--verbose', '-v', '--quiet', '-q', '--help', '-h'
  ]);

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const name = optionName(argument);

    if (AI_ONLY_OPTIONS.has(name)) {
      const suffix = AI_ONLY_OPTIONS.get(name) ? ' and its value' : '';
      throw new Error(
        `Legacy AI option ${name}${suffix} is not supported for terrain. ` +
        'Tiles now use the deterministic iso64-retina-v3 material compiler; remove the AI option.'
      );
    }

    if (booleanOptions.has(argument)) {
      translated.push(argument);
      continue;
    }

    if (valueOptions.has(name)) {
      const { value, consumed } = readOptionValue(argv, index, name);
      index += consumed;

      if (name === '--category' && !TILE_CATEGORIES.has(value)) {
        throw new Error(`Unsupported tile category "${value}". Use floors, walls, or slopes.`);
      }
      if (name === '--biome' && !TILE_BIOMES.has(value)) {
        throw new Error(`Unsupported tile biome "${value}". Use ${[...TILE_BIOMES].join(', ')}.`);
      }

      translated.push(name, value);
      continue;
    }

    throw new Error(`Unknown legacy tile option: ${argument}`);
  }

  return translated;
}

/** Translate the old validator's reporting-only --fix flag and pass through
 * the canonical validator's supported selectors/output controls. */
function translateLegacyValidatorArgs(argv) {
  const translated = [];
  const valueOptions = new Set([
    '--metadata-dir', '--assets-dir', '--biome', '--category', '--key'
  ]);
  const booleanOptions = new Set([
    '--metadata-only', '--allow-missing', '--strict', '--verbose', '-v',
    '--json', '--help', '-h'
  ]);

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const name = optionName(argument);

    if (argument === '--fix') {
      if (!translated.includes('--strict')) translated.push('--strict');
      if (!translated.includes('--verbose')) translated.push('--verbose');
      continue;
    }

    if (booleanOptions.has(argument)) {
      translated.push(argument);
      continue;
    }

    if (valueOptions.has(name)) {
      const { value, consumed } = readOptionValue(argv, index, name);
      index += consumed;
      translated.push(name, value);
      continue;
    }

    throw new Error(`Unknown legacy tile-validator option: ${argument}`);
  }

  return translated;
}

function runCanonicalScript(scriptPath, args, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    stdio: options.stdio || 'inherit',
    encoding: options.encoding
  });

  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Canonical tile command terminated by ${result.signal}`);
  }
  return result.status ?? 1;
}

function runCanonicalGenerator(args, options) {
  return runCanonicalScript(CANONICAL_GENERATOR, args, options);
}

function runCanonicalValidator(args, options) {
  return runCanonicalScript(CANONICAL_VALIDATOR, args, options);
}

module.exports = {
  CANONICAL_GENERATOR,
  CANONICAL_VALIDATOR,
  translateLegacyAiTileArgs,
  translateLegacyValidatorArgs,
  runCanonicalGenerator,
  runCanonicalValidator
};
