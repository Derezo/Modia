/**
 * @module parseArgs
 * @description Shared argument parsing for AI image generation scripts.
 *
 * Extracts common CLI flags (--dry-run, --key, --force, --backup, --huggingface,
 * --local, --verbose, --quiet, --delay, --lora, --queue, --help) into a single
 * reusable parser. Each script provides its extra flags via extraConfig.
 *
 * CRITICAL: --key accumulates into an array (keys: []) to support multiple
 * --key flags in a single invocation. This fixes the prior bug where repeated
 * --key flags overwrote each other.
 *
 * @see generate-icons.js, generate-tiles.js, generate-portraits.js,
 *      generate-items.js, generate-nodes.js, generate-overlays.js
 */

const { log } = require('./imageUtils');

const VALID_LORA_MODELS = ['v1', 'v2', 'modern-pixel', 'retro-pixel'];

/**
 * Base defaults shared by all generation scripts.
 */
const BASE_DEFAULTS = {
  dryRun: false,
  keys: [],
  force: false,
  backup: false,
  local: true,
  huggingface: false,
  verbose: false,
  quiet: false,
  delay: 2000,
  lora: null,
  queue: false,
  help: false
};

/**
 * Parse command line arguments with shared base flags and optional extra flags.
 *
 * @param {string[]} argv - Command line arguments (typically process.argv.slice(2))
 * @param {Object} [extraConfig] - Script-specific configuration
 * @param {Object.<string, {flag: string, aliases?: string[], type: 'string'|'boolean', default: *}>} [extraConfig.extraFlags]
 *   Additional flags beyond the base set. Each key is the option name in the
 *   returned object. Properties:
 *     - flag: The primary CLI flag string (e.g. '--category')
 *     - aliases: Optional array of alternative flag strings (e.g. ['--cat'])
 *     - type: 'string' requires a following value argument; 'boolean' is a toggle
 *     - default: The default value when the flag is not provided
 * @param {Object.<string, *>} [extraConfig.defaults] - Override base defaults
 * @param {boolean} [extraConfig.noQueue] - If true, --queue is not recognized (e.g. overlays)
 * @returns {Object} Parsed options with all base and extra flags resolved
 *
 * @example
 * // In generate-icons.js:
 * const options = parseBaseArgs(process.argv.slice(2), {
 *   extraFlags: {
 *     category: { flag: '--category', type: 'string', default: null }
 *   }
 * });
 *
 * @example
 * // In generate-overlays.js (no --queue support):
 * const options = parseBaseArgs(process.argv.slice(2), {
 *   extraFlags: {
 *     rarity:   { flag: '--rarity',   type: 'boolean', default: false },
 *     augments: { flag: '--augments', type: 'boolean', default: false },
 *     sizes:    { flag: '--sizes',    type: 'boolean', default: false }
 *   },
 *   noQueue: true
 * });
 *
 * @example
 * // In generate-characters.js (SD1.5 animation generation):
 * const options = parseBaseArgs(process.argv.slice(2), {
 *   extraFlags: {
 *     mode: { flag: '--mode', type: 'string', default: 'flux' },
 *     controlnetWeight: { flag: '--controlnet-weight', type: 'number', default: 0.7 },
 *     ipadapterWeight: { flag: '--ipadapter-weight', type: 'number', default: 0.4 },
 *     reference: { flag: '--reference', type: 'string', default: null },
 *     referenceOnly: { flag: '--reference-only', type: 'boolean', default: false },
 *     referencePose: { flag: '--reference-pose', type: 'string', default: 'idle' },
 *     autoReference: { flag: '--auto-reference', type: 'boolean', default: false }
 *   }
 * });
 */
function parseBaseArgs(argv, extraConfig = {}) {
  const { extraFlags = {}, defaults = {}, noQueue = false } = extraConfig;

  // Build options object with base defaults, then extra flag defaults, then overrides
  const options = { ...BASE_DEFAULTS };

  // Remove queue from base defaults if script does not support it
  if (noQueue) {
    delete options.queue;
  }

  // Apply extra flag defaults
  for (const [name, config] of Object.entries(extraFlags)) {
    options[name] = config.default;
  }

  // Apply any explicit default overrides
  Object.assign(options, defaults);

  // Build a lookup from flag string to { name, type }
  const extraFlagLookup = new Map();
  for (const [name, config] of Object.entries(extraFlags)) {
    extraFlagLookup.set(config.flag, { name, type: config.type });
    if (config.aliases) {
      for (const alias of config.aliases) {
        extraFlagLookup.set(alias, { name, type: config.type });
      }
    }
  }

  const args = argv;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Check extra flags first so they can shadow base flags if needed
    const extraMatch = extraFlagLookup.get(arg);
    if (extraMatch) {
      if (extraMatch.type === 'string' || extraMatch.type === 'number') {
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log(`${arg} requires a value`, 'error');
          process.exit(1);
        }
        const rawValue = args[++i];
        if (extraMatch.type === 'number') {
          const numValue = parseFloat(rawValue);
          if (isNaN(numValue)) {
            log(`${arg} requires a numeric value, got: ${rawValue}`, 'error');
            process.exit(1);
          }
          options[extraMatch.name] = numValue;
        } else {
          options[extraMatch.name] = rawValue;
        }
      } else {
        // Boolean flag
        options[extraMatch.name] = true;
      }
      continue;
    }

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;

      case '--key':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--key requires a value', 'error');
          process.exit(1);
        }
        options.keys.push(args[++i]);
        break;

      case '--force':
        options.force = true;
        break;

      case '--backup':
        options.backup = true;
        break;

      case '--huggingface':
      case '--hf':
        options.huggingface = true;
        options.local = false;
        break;

      case '--local':
        options.local = true;
        options.huggingface = false;
        break;

      case '--verbose':
      case '-v':
        options.verbose = true;
        break;

      case '--quiet':
      case '-q':
        options.quiet = true;
        break;

      case '--delay':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--delay requires a value', 'error');
          process.exit(1);
        }
        options.delay = parseInt(args[++i], 10);
        if (isNaN(options.delay)) {
          log('--delay requires a numeric value', 'error');
          process.exit(1);
        }
        break;

      case '--lora': {
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log(`--lora requires a value (${VALID_LORA_MODELS.join(', ')})`, 'error');
          process.exit(1);
        }
        options.lora = args[++i];
        if (!VALID_LORA_MODELS.includes(options.lora)) {
          log(`Invalid --lora value: ${options.lora}. Valid options: ${VALID_LORA_MODELS.join(', ')}`, 'error');
          process.exit(1);
        }
        break;
      }

      case '--queue':
        if (noQueue) {
          log(`Unknown option: ${arg}`, 'warn');
        } else {
          options.queue = true;
          options.force = true; // Queue mode implies --force since assets are marked for regen
        }
        break;

      case '--help':
      case '-h':
        options.help = true;
        break;

      default:
        if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
          log(`Unknown option: ${arg}`, 'warn');
        }
    }
  }

  return options;
}

module.exports = { parseBaseArgs, VALID_LORA_MODELS, BASE_DEFAULTS };
