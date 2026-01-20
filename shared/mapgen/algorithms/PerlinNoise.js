/**
 * PerlinNoise - 2D Simplex noise with Fractal Brownian Motion (FBM)
 *
 * Provides smooth, natural-looking gradients for terrain generation.
 * Uses simplex noise which is faster and has fewer directional artifacts
 * than classic Perlin noise.
 *
 * CRITICAL: All methods that take a random function must use it deterministically
 * to maintain server/client sync.
 */

// Gradient vectors for 2D simplex noise
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1]
];

// Skew factors for 2D simplex
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Simplex Noise 2D Generator
 * Seeded permutation table for deterministic noise
 */
export class SimplexNoise {
  /**
   * @param {function} random - Seeded random function returning 0-1
   */
  constructor(random) {
    // Generate permutation table from seeded random
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);

    // Initialize with values 0-255
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }

    // Fisher-Yates shuffle using seeded random
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }

    // Duplicate for wrap-around
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  /**
   * Get gradient index at grid position
   */
  _gradIndex(x, y) {
    return this.perm[(x + this.perm[y & 255]) & 255] % 8;
  }

  /**
   * Dot product of gradient and distance vector
   */
  _dot2(gradIdx, x, y) {
    const g = GRAD2[gradIdx];
    return g[0] * x + g[1] * y;
  }

  /**
   * Generate 2D simplex noise at coordinates
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {number} Noise value in range [-1, 1]
   */
  noise2D(x, y) {
    // Skew input space to determine which simplex cell we're in
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    // Unskew back to (x, y) space
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;

    // Distance from cell origin
    const x0 = x - X0;
    const y0 = y - Y0;

    // Determine which simplex we're in (upper or lower triangle)
    let i1, j1;
    if (x0 > y0) {
      i1 = 1; j1 = 0;  // Lower triangle
    } else {
      i1 = 0; j1 = 1;  // Upper triangle
    }

    // Offsets for second and third corners
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    // Calculate contributions from three corners
    let n0 = 0, n1 = 0, n2 = 0;

    // Corner 0
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const gi0 = this._gradIndex(i, j);
      n0 = t0 * t0 * this._dot2(gi0, x0, y0);
    }

    // Corner 1
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const gi1 = this._gradIndex(i + i1, j + j1);
      n1 = t1 * t1 * this._dot2(gi1, x1, y1);
    }

    // Corner 2
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const gi2 = this._gradIndex(i + 1, j + 1);
      n2 = t2 * t2 * this._dot2(gi2, x2, y2);
    }

    // Scale to [-1, 1]
    return 70 * (n0 + n1 + n2);
  }

  /**
   * Fractal Brownian Motion - layered noise for natural terrain
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} octaves - Number of noise layers (1-8)
   * @param {number} persistence - Amplitude reduction per octave (0.3-0.7)
   * @param {number} lacunarity - Frequency increase per octave (1.5-2.5)
   * @returns {number} FBM value in range [-1, 1]
   */
  fbm(x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // Normalize to [-1, 1]
    return total / maxValue;
  }

  /**
   * Ridged multifractal noise - creates ridge-like terrain
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} octaves - Number of noise layers
   * @param {number} persistence - Amplitude reduction per octave
   * @param {number} lacunarity - Frequency increase per octave
   * @returns {number} Ridge value in range [0, 1]
   */
  ridgedNoise(x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      // Take absolute value and invert to create ridges
      let signal = Math.abs(this.noise2D(x * frequency, y * frequency));
      signal = 1.0 - signal;
      signal *= signal; // Square for sharper ridges
      total += signal * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }
}

/**
 * PerlinNoise Algorithm - applies noise-based terrain distribution
 *
 * Used for:
 * - Terrain gradients (grass to rock transitions)
 * - Organic clustering of features
 * - Elevation mapping
 */
export class PerlinNoiseAlgorithm {
  /**
   * @param {Object} options - Algorithm options
   * @param {number} options.scale - Noise scale (0.05-0.2 typical)
   * @param {number} options.octaves - FBM octaves (1-6)
   * @param {number} options.persistence - Amplitude falloff (0.3-0.7)
   * @param {Object} options.thresholds - Terrain type thresholds
   */
  constructor(options = {}) {
    this.scale = options.scale || 0.1;
    this.octaves = options.octaves || 4;
    this.persistence = options.persistence || 0.5;
    this.thresholds = options.thresholds || {
      // Default thresholds for forest biome
      // Values are noise thresholds [-1, 1] mapped to terrain types
      rock: 0.6,      // Above 0.6 -> rock
      forest: 0.2,    // 0.2 to 0.6 -> forest
      grass: -1.0     // Below 0.2 -> grass
    };
  }

  /**
   * Apply noise-based terrain to map
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Effect intensity (0-1)
   * @param {string} options.nodeType - Biome type for threshold selection
   */
  apply(terrain, random, options = {}) {
    const intensity = options.intensity || 0.5;
    const width = terrain[0].length;
    const height = terrain.length;

    // Create noise generator with seeded permutation
    const noise = new SimplexNoise(random);

    // Sample noise at each position
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x * this.scale;
        const ny = y * this.scale;

        // Get FBM noise value
        const noiseValue = noise.fbm(nx, ny, this.octaves, this.persistence);

        // Only apply based on intensity (blend with existing)
        if (random() < intensity) {
          terrain[y][x] = this._noiseToTerrain(noiseValue);
        }
      }
    }
  }

  /**
   * Convert noise value to terrain type
   */
  _noiseToTerrain(value) {
    // Check thresholds from highest to lowest
    if (value >= this.thresholds.rock) return 'rock';
    if (value >= this.thresholds.forest) return 'forest';
    return 'grass';
  }

  /**
   * Generate noise map for external use (elevation, etc.)
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {function} random - Seeded random function
   * @returns {number[][]} 2D array of noise values [-1, 1]
   */
  generateNoiseMap(width, height, random) {
    const noise = new SimplexNoise(random);
    const map = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const nx = x * this.scale;
        const ny = y * this.scale;
        row.push(noise.fbm(nx, ny, this.octaves, this.persistence));
      }
      map.push(row);
    }

    return map;
  }

  /**
   * Generate terrain with seed regions for CA refinement
   *
   * This method outputs:
   * - terrain: The generated terrain grid
   * - noiseMap: Raw noise values for each tile
   * - seedRegions: Set of coordinates where CA should operate
   *
   * Seed regions are tiles where noise is in the "boundary" range between
   * clearly defined terrain types. CA can smooth these transition areas.
   *
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Effect intensity (0-1)
   * @param {number} options.seedMinThreshold - Min noise for seed region (default 0.3)
   * @param {number} options.seedMaxThreshold - Max noise for seed region (default 0.5)
   * @param {Object} options.context - LayerContext for sharing data
   * @returns {Object} { noiseMap, seedRegions }
   */
  applyWithSeedRegions(terrain, random, options = {}) {
    const intensity = options.intensity || 0.5;
    const seedMinThreshold = options.seedMinThreshold ?? 0.3;
    const seedMaxThreshold = options.seedMaxThreshold ?? 0.5;
    const context = options.context || null;

    const width = terrain[0].length;
    const height = terrain.length;

    // Create noise generator with seeded permutation
    const noise = new SimplexNoise(random);

    // Generate noise map and seed regions
    const noiseMap = [];
    const seedRegions = new Set();

    for (let y = 0; y < height; y++) {
      const noiseRow = [];
      for (let x = 0; x < width; x++) {
        const nx = x * this.scale;
        const ny = y * this.scale;

        // Get FBM noise value
        const noiseValue = noise.fbm(nx, ny, this.octaves, this.persistence);
        noiseRow.push(noiseValue);

        // Apply terrain based on intensity
        if (random() < intensity) {
          terrain[y][x] = this._noiseToTerrain(noiseValue);
        }

        // Mark as seed region if in boundary range
        if (noiseValue >= seedMinThreshold && noiseValue <= seedMaxThreshold) {
          seedRegions.add(`${x},${y}`);
        }
      }
      noiseMap.push(noiseRow);
    }

    // Store in context if provided
    if (context) {
      context.setNoiseMap(noiseMap);
      context.setSeedRegions(seedRegions);
    }

    return { noiseMap, seedRegions };
  }

  /**
   * Apply noise-based terrain with configurable threshold behavior
   *
   * Enhanced version that supports more terrain types and can output
   * to context for pipeline cooperation.
   *
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {boolean} options.outputSeedRegions - Generate seed regions for CA
   * @param {Object} options.context - LayerContext for sharing data
   */
  applyEnhanced(terrain, random, options = {}) {
    if (options.outputSeedRegions) {
      return this.applyWithSeedRegions(terrain, random, options);
    }

    // Standard apply
    this.apply(terrain, random, options);

    // If context provided, generate noise map for reference
    if (options.context) {
      const noise = new SimplexNoise(random);
      const noiseMap = [];
      const width = terrain[0].length;
      const height = terrain.length;

      for (let y = 0; y < height; y++) {
        const noiseRow = [];
        for (let x = 0; x < width; x++) {
          const nx = x * this.scale;
          const ny = y * this.scale;
          noiseRow.push(noise.fbm(nx, ny, this.octaves, this.persistence));
        }
        noiseMap.push(noiseRow);
      }

      options.context.setNoiseMap(noiseMap);
    }

    return null;
  }
}

export default PerlinNoiseAlgorithm;
