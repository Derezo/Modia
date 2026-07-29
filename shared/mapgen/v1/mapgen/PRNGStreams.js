/**
 * PRNGStreams - Modular PRNG Streams for Map Generation
 *
 * Provides isolated random number generator streams for different subsystems
 * of map generation. This ensures that changes in one subsystem (e.g., obstacle
 * placement) don't affect another (e.g., terrain generation), enabling:
 *
 * - Predictable output when modifying individual systems
 * - Easier debugging of specific generation steps
 * - Cross-system determinism without coupling
 *
 * Each stream uses a unique salt XORed with the base seed to create
 * independent but reproducible random sequences.
 *
 * CRITICAL: All map generation should use streams from this module
 * to maintain determinism and isolation.
 */

// ============================================================================
// STREAM SALTS - MATHEMATICAL CONSTANTS
// ============================================================================

/**
 * Stream salts derived from mathematical constants
 * These provide good dispersion when XORed with arbitrary seeds
 */
export const STREAM_SALTS = {
  /** Structure generation (rooms, graph, POIs) - Golden ratio bits */
  structure: 0x9E3779B9,

  /** Terrain generation (perlin, cellular automata) - Pi bits */
  terrain: 0x243F6A88,

  /** Detail generation (path wandering, clusters) - e bits */
  detail: 0xB7E15162,

  /** Tile variants (visual variety) */
  variants: 0x85EBCA6B,

  /** Spawn positioning (player/enemy placement) */
  spawns: 0xC2B2AE35,

  /** Obstacle selection and placement */
  obstacles: 0x4CF5AD43,

  /** Elevation generation and connections */
  elevation: 0x52DCE729,

  /** Cover grid placement */
  cover: 0x38B34AE5,

  /** Constraint repair operations */
  repair: 0x1B2AE775
};

// ============================================================================
// PRNG IMPLEMENTATION - MULBERRY32
// ============================================================================

/**
 * Mulberry32 PRNG implementation
 * Fast, high-quality 32-bit generator with good statistical properties
 *
 * @param {number} seed - 32-bit seed value
 * @returns {function} Random function returning values in [0, 1)
 */
export function mulberry32(seed) {
  let state = seed >>> 0; // Ensure unsigned 32-bit

  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a salted seed by XORing base seed with salt
 *
 * @param {number} baseSeed - Original seed value
 * @param {number} salt - Salt value for isolation
 * @returns {number} Combined seed value
 */
export function saltSeed(baseSeed, salt) {
  return (baseSeed ^ salt) >>> 0;
}

// ============================================================================
// PRNG STREAMS FACTORY
// ============================================================================

/**
 * PRNGStreams - Container for isolated PRNG streams
 *
 * @example
 * const streams = createPRNGStreams(worldSeed);
 *
 * // Each stream is independent
 * const terrainValue = streams.terrain();
 * const structureValue = streams.structure();
 *
 * // Get raw stream for passing to subsystems
 * const pathCarverRandom = streams.getStream('detail');
 */
export class PRNGStreams {
  /**
   * Create PRNG streams from a base seed
   *
   * @param {number} baseSeed - Base seed for all streams
   */
  constructor(baseSeed) {
    this.baseSeed = baseSeed >>> 0;

    // Create streams for each category
    this._streams = {};
    for (const [name, salt] of Object.entries(STREAM_SALTS)) {
      const saltedSeed = saltSeed(baseSeed, salt);
      this._streams[name] = mulberry32(saltedSeed);
    }
  }

  /**
   * Get a random value from the structure stream
   * Used for: room placement, graph building, POI generation
   * @returns {number} Random value in [0, 1)
   */
  structure() {
    return this._streams.structure();
  }

  /**
   * Get a random value from the terrain stream
   * Used for: perlin noise permutation, cellular automata
   * @returns {number} Random value in [0, 1)
   */
  terrain() {
    return this._streams.terrain();
  }

  /**
   * Get a random value from the detail stream
   * Used for: path wandering, cluster placement, jitter
   * @returns {number} Random value in [0, 1)
   */
  detail() {
    return this._streams.detail();
  }

  /**
   * Get a random value from the variants stream
   * Used for: tile variant selection
   * @returns {number} Random value in [0, 1)
   */
  variants() {
    return this._streams.variants();
  }

  /**
   * Get a random value from the spawns stream
   * Used for: spawn position selection, shuffle
   * @returns {number} Random value in [0, 1)
   */
  spawns() {
    return this._streams.spawns();
  }

  /**
   * Get a random value from the obstacles stream
   * Used for: obstacle type selection, placement
   * @returns {number} Random value in [0, 1)
   */
  obstacles() {
    return this._streams.obstacles();
  }

  /**
   * Get a random value from the elevation stream
   * Used for: elevation generation, connection types
   * @returns {number} Random value in [0, 1)
   */
  elevation() {
    return this._streams.elevation();
  }

  /**
   * Get a random value from the cover stream
   * Used for: cover grid placement, symmetry
   * @returns {number} Random value in [0, 1)
   */
  cover() {
    return this._streams.cover();
  }

  /**
   * Get a random value from the repair stream
   * Used for: constraint repair operations
   * @returns {number} Random value in [0, 1)
   */
  repair() {
    return this._streams.repair();
  }

  /**
   * Get a stream function by name
   * Use this when passing a random function to algorithms
   *
   * @param {string} streamName - Name of the stream
   * @returns {function} Bound random function
   */
  getStream(streamName) {
    if (!this._streams[streamName]) {
      throw new Error(`Unknown PRNG stream: ${streamName}`);
    }
    return this._streams[streamName];
  }

  /**
   * Get all available stream names
   * @returns {string[]} Array of stream names
   */
  getStreamNames() {
    return Object.keys(this._streams);
  }

  /**
   * Create a sub-stream with additional salt
   * Useful for nested generation that needs isolation within a subsystem
   *
   * @param {string} baseStreamName - Base stream to derive from
   * @param {number} subSalt - Additional salt value
   * @returns {function} New isolated random function
   */
  createSubStream(baseStreamName, subSalt) {
    const baseSalt = STREAM_SALTS[baseStreamName];
    if (baseSalt === undefined) {
      throw new Error(`Unknown base stream: ${baseStreamName}`);
    }

    const combinedSalt = saltSeed(baseSalt, subSalt);
    const subSeed = saltSeed(this.baseSeed, combinedSalt);
    return mulberry32(subSeed);
  }

  /**
   * Fork the streams at current state
   * Creates a new PRNGStreams with different base seed
   *
   * @param {number} forkSalt - Salt for the fork
   * @returns {PRNGStreams} New independent streams
   */
  fork(forkSalt) {
    const forkedSeed = saltSeed(this.baseSeed, forkSalt);
    return new PRNGStreams(forkedSeed);
  }

  /**
   * Get the base seed
   * @returns {number} The base seed
   */
  getSeed() {
    return this.baseSeed;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new set of PRNG streams from a seed
 *
 * @param {number} baseSeed - Base seed value
 * @returns {PRNGStreams} PRNG streams instance
 *
 * @example
 * const streams = createPRNGStreams(battleSeed);
 *
 * // Use in terrain generation
 * const terrainRandom = streams.getStream('terrain');
 * const noiseGen = new SimplexNoise(terrainRandom);
 *
 * // Use in structure generation
 * const structureRandom = streams.getStream('structure');
 * const rooms = roomCarver.apply(terrain, structureRandom);
 */
export function createPRNGStreams(baseSeed) {
  return new PRNGStreams(baseSeed);
}

// ============================================================================
// STREAM ROUTING GUIDE
// ============================================================================

/**
 * Stream routing reference:
 *
 * | Component               | Stream      |
 * |------------------------|-------------|
 * | Archetype selection    | structure   |
 * | Room placement         | structure   |
 * | POI generation         | structure   |
 * | Graph building (MST)   | structure   |
 * | Perlin noise           | terrain     |
 * | Cellular automata      | terrain     |
 * | Path wandering         | detail      |
 * | Cluster placement      | detail      |
 * | Tile variants          | variants    |
 * | Spawn positioning      | spawns      |
 * | Obstacle selection     | obstacles   |
 * | Elevation generation   | elevation   |
 * | Connection types       | elevation   |
 * | Cover grid placement   | cover       |
 * | Constraint repair      | repair      |
 */

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

/**
 * Create a single seeded random function (legacy compatibility)
 * Use this when migrating code that expects a single random function
 *
 * @param {number} seed - Seed value
 * @returns {function} Random function
 */
export function createSeededRandom(seed) {
  return mulberry32(seed);
}

/**
 * Create streams or fallback to single random for migration
 *
 * @param {number} seed - Seed value
 * @param {boolean} useStreams - Whether to use stream system
 * @returns {PRNGStreams|function} Streams or legacy random function
 */
export function createRandomSource(seed, useStreams = true) {
  if (useStreams) {
    return createPRNGStreams(seed);
  }
  return createSeededRandom(seed);
}

export default PRNGStreams;
