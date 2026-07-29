/**
 * Cross-runtime deterministic helpers for Battle Map Generation V2.
 *
 * These helpers deliberately use integer arithmetic at every decision
 * boundary. Floating-point values may be used as working values, but callers
 * must quantize them before classification, sorting, or candidate ranking.
 */

export const V2_STREAM_VERSION = 'bmg-v2-streams-v1';
export const V2_QUANTIZATION_SCALE = 1_000_000;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function assertSafeSeed(seed) {
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed)) {
      throw new TypeError('terrainSeed must be a safe integer or non-empty string');
    }
    return String(seed);
  }
  if (typeof seed === 'string' && seed.length > 0) return seed;
  throw new TypeError('terrainSeed must be a safe integer or non-empty string');
}

/** Stable 32-bit hash over JavaScript UTF-16 code units. */
export function hashString32(value, seed = FNV_OFFSET) {
  const text = String(value);
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    const codeUnit = text.charCodeAt(index);
    hash ^= codeUnit & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= codeUnit >>> 8;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function deriveAttemptSeed(terrainSeed, terrainGenerationVersion, attempt) {
  if (!Number.isInteger(terrainGenerationVersion) || terrainGenerationVersion < 1) {
    throw new TypeError('terrainGenerationVersion must be a positive integer');
  }
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError('attempt must be a nonnegative integer');
  }
  return hashString32(
    `${assertSafeSeed(terrainSeed)}\0${terrainGenerationVersion}\0${attempt}`,
    0x6d2b79f5
  );
}

export function deriveStreamSeed(attemptSeed, streamName) {
  if (!Number.isSafeInteger(attemptSeed) || attemptSeed < 0) {
    throw new TypeError('attemptSeed must be a nonnegative safe integer');
  }
  if (typeof streamName !== 'string' || streamName.length === 0) {
    throw new TypeError('streamName must be a non-empty string');
  }
  return hashString32(`${attemptSeed >>> 0}\0${streamName}`, 0x9e3779b9);
}

/** Mulberry32 with an explicitly unsigned state. */
export function createDeterministicRandom(seed) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function createNamedRandom(attemptSeed, streamName) {
  return createDeterministicRandom(deriveStreamSeed(attemptSeed, streamName));
}

/**
 * Scan-order-independent coordinate hash. The salt should identify the field
 * or decision being made so unrelated visual or semantic choices cannot drift.
 */
export function coordinateHash32(seed, x, y, salt = '') {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new TypeError('coordinateHash32 coordinates must be integers');
  }
  return hashString32(`${seed >>> 0}\0${x}\0${y}\0${salt}`, 0x27d4eb2f);
}

export function coordinateUnit(seed, x, y, salt = '') {
  return coordinateHash32(seed, x, y, salt) / 0x100000000;
}

/**
 * Round half away from zero to an integer fixed-point value. Returning the
 * integer representation makes threshold and sort boundaries unambiguous.
 */
export function quantizeFixed(value, scale = V2_QUANTIZATION_SCALE) {
  if (!Number.isFinite(value)) throw new TypeError('Cannot quantize a non-finite value');
  if (!Number.isSafeInteger(scale) || scale <= 0) {
    throw new TypeError('scale must be a positive safe integer');
  }
  const scaled = value * scale;
  const rounded = scaled < 0
    ? -Math.floor(-scaled + 0.5)
    : Math.floor(scaled + 0.5);
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError('Quantized value exceeds the safe integer range');
  }
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function dequantizeFixed(value, scale = V2_QUANTIZATION_SCALE) {
  if (!Number.isSafeInteger(value)) throw new TypeError('value must be a safe integer');
  if (!Number.isSafeInteger(scale) || scale <= 0) {
    throw new TypeError('scale must be a positive safe integer');
  }
  return value / scale;
}

export function stableLexicographicCompare(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

