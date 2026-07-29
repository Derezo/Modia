const CONTEXT_KEYS = [
  'request',
  'resolvedRecipe',
  'feasibility',
  'spawnContract',
  'spawnLayout',
  'landscapeFields',
  'continuousElevation',
  'elevationLevels',
  'elevation',
  'connectionCandidates',
  'terrain',
  'regionIndex',
  'hydrology',
  'routes',
  'selectedConnections',
  'spawnIntegration',
  'ecology',
  'obstacles',
  'visualLayers',
  'variants',
  'transitions',
  'decorations',
  'features',
  'validation',
  'diagnostics'
];

export const V2_CONTEXT_KEYS = Object.freeze([...CONTEXT_KEYS]);
const CONTEXT_KEY_SET = new Set(CONTEXT_KEYS);

function assertContextKey(key) {
  if (!CONTEXT_KEY_SET.has(key)) {
    throw new TypeError(`Unknown V2 context key: ${String(key)}`);
  }
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

/**
 * Typed publication boundary between V2 stages.
 *
 * Values are recursively frozen as they are published. A stage that needs to
 * change a layer must publish a replacement through the typed-edit framework,
 * rather than mutating an earlier stage's output.
 */
export class V2Context {
  constructor({ width, height, terrainSeed, attempt, attemptSeed }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new TypeError('V2Context width and height must be positive integers');
    }
    if (!Number.isInteger(attempt) || attempt < 0) {
      throw new TypeError('V2Context attempt must be a nonnegative integer');
    }
    if (!Number.isSafeInteger(attemptSeed) || attemptSeed < 0) {
      throw new TypeError('V2Context attemptSeed must be a nonnegative safe integer');
    }
    this.width = width;
    this.height = height;
    this.terrainSeed = terrainSeed;
    this.attempt = attempt;
    this.attemptSeed = attemptSeed;
    this._values = new Map();
    this._producers = new Map();
    this._stageEvents = [];
  }

  has(key) {
    assertContextKey(key);
    return this._values.has(key);
  }

  get(key) {
    assertContextKey(key);
    return this._values.get(key);
  }

  require(key) {
    assertContextKey(key);
    if (!this._values.has(key)) {
      throw new Error(`Required V2 context key is missing: ${key}`);
    }
    return this._values.get(key);
  }

  publish(key, value, producer, { replace = false } = {}) {
    assertContextKey(key);
    if (value === undefined) {
      throw new TypeError(`V2 context key ${key} cannot publish undefined`);
    }
    if (typeof producer !== 'string' || producer.length === 0) {
      throw new TypeError('V2 context producer must be a non-empty stage ID');
    }
    if (this._values.has(key) && !replace) {
      throw new Error(
        `V2 context key ${key} was already published by ${this._producers.get(key)}`
      );
    }
    this._values.set(key, deepFreeze(value));
    this._producers.set(key, producer);
    return this._values.get(key);
  }

  producerOf(key) {
    assertContextKey(key);
    return this._producers.get(key) ?? null;
  }

  recordStageEvent(event) {
    this._stageEvents.push(deepFreeze({ ...event }));
  }

  getStageEvents() {
    return Object.freeze([...this._stageEvents]);
  }

  toObject() {
    const result = {};
    for (const key of CONTEXT_KEYS) {
      if (this._values.has(key)) result[key] = this._values.get(key);
    }
    return deepFreeze(result);
  }
}

export function createV2Context(options) {
  return new V2Context(options);
}
