/**
 * Deterministic seed, random-stream, and canonical encoding utilities for
 * world generation.
 *
 * Stream salts and version numbers are part of the generated-world contract.
 * Changing either intentionally produces a different world.
 */

import { SeededRandom } from '../../config/constants.js';

export const DEFAULT_WORLD_SEED = 123456;
export const GENERATOR_VERSION = 1;
export const WORLDGEN_GENERATOR_VERSION = GENERATOR_VERSION;
export const RANDOM_STREAM_VERSION = 1;

const SIGNED_INT32_MIN = -2147483648;
const SIGNED_INT32_MAX = 2147483647;
const INTEGER_TEXT = /^[+-]?\d+$/;

/**
 * Fixed, unique 32-bit salts for independently consumed worldgen streams.
 */
export const RANDOM_STREAM_SALTS = Object.freeze({
  castlePlacement: 0x9E3779B9,
  regionalNodes: 0x243F6A88,
  internalConnections: 0xB7E15162,
  interRegionRoutes: 0x85EBCA6B,
  finalization: 0xC2B2AE35,
  namesFeatures: 0x4CF5AD43,
  worldObstacles: 0x52DCE729
});

/**
 * Parse a world seed without truncation, coercion, or 32-bit wrapping.
 *
 * Only an unset (undefined) value receives the default. In particular, null
 * and an empty string are invalid rather than aliases for the default.
 *
 * @param {unknown} value
 * @returns {number} A signed 32-bit integer.
 */
export function parseWorldSeed(value = DEFAULT_WORLD_SEED) {
  let parsed;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && INTEGER_TEXT.test(value)) {
    parsed = Number(value);
  } else {
    throw new TypeError('World seed must be a signed 32-bit integer');
  }

  if (!Number.isInteger(parsed)
      || parsed < SIGNED_INT32_MIN
      || parsed > SIGNED_INT32_MAX) {
    throw new RangeError(
      `World seed must be between ${SIGNED_INT32_MIN} and ${SIGNED_INT32_MAX}`
    );
  }

  // Keep the seed representation canonical when the input is -0 or "-0".
  return Object.is(parsed, -0) ? 0 : parsed;
}

function parseVersion(value, label) {
  const parsed = parseWorldSeed(value);
  if (parsed < 1) {
    throw new RangeError(`${label} must be a positive signed 32-bit integer`);
  }
  return parsed;
}

/**
 * Normalize assembly seed/version input.
 *
 * `seed` is the preferred input name; `worldSeed` is accepted for persistence
 * and API callers. Both names are returned with the same normalized value.
 *
 * @param {object|number|string} [input]
 * @returns {{seed: number, worldSeed: number, generatorVersion: number,
 *   randomStreamVersion: number}}
 */
export function createWorldgenConfig(input = {}) {
  const raw = (typeof input === 'object' && input !== null && !Array.isArray(input))
    ? input
    : { seed: input };

  const hasSeed = Object.prototype.hasOwnProperty.call(raw, 'seed');
  const seedValue = hasSeed ? raw.seed : raw.worldSeed;
  const seed = parseWorldSeed(seedValue);
  const generatorVersion = parseVersion(
    raw.generatorVersion === undefined ? GENERATOR_VERSION : raw.generatorVersion,
    'Generator version'
  );
  const randomStreamVersion = parseVersion(
    raw.randomStreamVersion === undefined
      ? RANDOM_STREAM_VERSION
      : raw.randomStreamVersion,
    'Random stream version'
  );

  return Object.freeze({
    seed,
    worldSeed: seed,
    generatorVersion,
    randomStreamVersion
  });
}

export const normalizeWorldgenConfig = createWorldgenConfig;

function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85EBCA6B);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xC2B2AE35);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/**
 * Derive a stream-specific signed 32-bit seed.
 *
 * @param {number|string|object} seedOrConfig
 * @param {keyof RANDOM_STREAM_SALTS} streamName
 * @param {number} [randomStreamVersion]
 * @param {number} [generatorVersion]
 * @returns {number}
 */
export function deriveRandomStreamSeed(
  seedOrConfig,
  streamName,
  randomStreamVersion = RANDOM_STREAM_VERSION,
  generatorVersion = GENERATOR_VERSION
) {
  if (!Object.prototype.hasOwnProperty.call(RANDOM_STREAM_SALTS, streamName)) {
    throw new RangeError(`Unknown worldgen random stream: ${streamName}`);
  }

  const config = (typeof seedOrConfig === 'object' && seedOrConfig !== null)
    ? createWorldgenConfig(seedOrConfig)
    : createWorldgenConfig({
      seed: seedOrConfig,
      generatorVersion,
      randomStreamVersion
    });

  let derived = mix32(
    (config.seed >>> 0) ^ RANDOM_STREAM_SALTS[streamName]
  );
  derived = mix32(
    derived ^ (config.generatorVersion >>> 0) ^ 0x27D4EB2F
  );
  derived = mix32(
    derived ^ (config.randomStreamVersion >>> 0) ^ 0x165667B1
  );

  return derived | 0;
}

/**
 * Create one isolated SeededRandom instance for a named stream.
 *
 * @param {keyof RANDOM_STREAM_SALTS} streamName
 * @param {number|string|object} seedOrConfig
 * @returns {SeededRandom}
 */
export function createRandomStream(streamName, seedOrConfig) {
  return new SeededRandom(deriveRandomStreamSeed(seedOrConfig, streamName));
}

/**
 * Create all named world-generation streams.
 *
 * @param {number|string|object} seedOrConfig
 * @param {number} [randomStreamVersion]
 * @param {number} [generatorVersion]
 * @returns {Readonly<Record<keyof RANDOM_STREAM_SALTS, SeededRandom>>}
 */
export function createRandomStreams(
  seedOrConfig,
  randomStreamVersion = RANDOM_STREAM_VERSION,
  generatorVersion = GENERATOR_VERSION
) {
  const config = (typeof seedOrConfig === 'object' && seedOrConfig !== null)
    ? createWorldgenConfig(seedOrConfig)
    : createWorldgenConfig({
      seed: seedOrConfig,
      generatorVersion,
      randomStreamVersion
    });

  return Object.freeze(Object.fromEntries(
    Object.keys(RANDOM_STREAM_SALTS).map((streamName) => [
      streamName,
      createRandomStream(streamName, config)
    ])
  ));
}

export const createWorldgenRandomStreams = createRandomStreams;

/**
 * Create an independent set of named streams for a bounded deterministic
 * assembly retry. Attempt zero is byte-for-byte compatible with the primary
 * stream set.
 *
 * @param {number|string|object} seedOrConfig
 * @param {number} attempt
 * @returns {Readonly<Record<keyof RANDOM_STREAM_SALTS, SeededRandom>>}
 */
export function createRandomStreamsForAttempt(seedOrConfig, attempt = 0) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError('World-generation attempt must be a nonnegative integer');
  }
  if (attempt === 0) return createRandomStreams(seedOrConfig);

  const config = createWorldgenConfig(seedOrConfig);
  const attemptSalt = mix32(attempt ^ 0xA511E9B3);
  return Object.freeze(Object.fromEntries(
    Object.keys(RANDOM_STREAM_SALTS).map((streamName) => {
      const baseSeed = deriveRandomStreamSeed(config, streamName);
      return [streamName, new SeededRandom(mix32((baseSeed >>> 0) ^ attemptSalt) | 0)];
    })
  ));
}

/**
 * Compare canonical object keys by UTF-16 code-unit order.
 *
 * This is the ordering used by JavaScript's default string sort and by JSON
 * canonicalization standards.
 */
export function canonicalKeyCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export const canonicalCompare = canonicalKeyCompare;

/**
 * Produce ECMAScript's shortest round-trippable JSON representation of a
 * finite number. Negative zero is normalized to zero.
 *
 * @param {number} value
 * @returns {string}
 */
export function canonicalNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON numbers must be finite numbers');
  }
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

function serializeCanonical(value, ancestors) {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'object':
      break;
    default:
      throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError('Cannot canonicalize a cyclic value');
  }
  ancestors.add(value);

  let serialized;
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical JSON arrays cannot contain symbol keys');
    }

    const items = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError('Canonical JSON arrays cannot be sparse');
      }
      items.push(serializeCanonical(value[index], ancestors));
    }

    for (const key of Object.keys(value)) {
      const index = Number(key);
      if (!Number.isInteger(index)
          || index < 0
          || index >= value.length
          || String(index) !== key) {
        throw new TypeError('Canonical JSON arrays cannot contain named properties');
      }
    }
    serialized = `[${items.join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON objects must be plain objects');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical JSON objects cannot contain symbol keys');
    }

    const entries = Object.keys(value)
      .sort(canonicalKeyCompare)
      .map((key) => (
        `${JSON.stringify(key)}:${serializeCanonical(value[key], ancestors)}`
      ));
    serialized = `{${entries.join(',')}}`;
  }

  ancestors.delete(value);
  return serialized;
}

/**
 * Serialize a JSON-compatible value with stable object-key and number rules.
 *
 * Arrays retain their supplied order. Unsupported/lossy JSON values,
 * nonfinite numbers, sparse arrays, and cycles are rejected.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalStringify(value) {
  return serializeCanonical(value, new Set());
}

/**
 * Return a detached JSON value normalized to canonical key/number rules.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalize(value) {
  return JSON.parse(canonicalStringify(value));
}

/**
 * UTF-8 encode canonical JSON for direct use with a SHA-256 implementation.
 *
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function canonicalEncode(value) {
  return new TextEncoder().encode(canonicalStringify(value));
}
