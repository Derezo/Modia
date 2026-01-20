/**
 * Noise Generation Utilities for Procedural Tile Generation
 * Implements Perlin noise and related algorithms
 */

/**
 * Permutation table for noise generation
 * @type {number[]}
 */
const PERMUTATION = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180
];

// Double the permutation table for overflow handling
const P = [...PERMUTATION, ...PERMUTATION];

/**
 * Fade function for smooth interpolation
 */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Linear interpolation
 */
function lerp(t, a, b) {
  return a + t * (b - a);
}

/**
 * Gradient function for 2D noise
 */
function grad2D(hash, x, y) {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * 2D Perlin noise implementation
 */
function perlin2D(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = P[P[X] + Y];
  const ab = P[P[X] + Y + 1];
  const ba = P[P[X + 1] + Y];
  const bb = P[P[X + 1] + Y + 1];
  const x1 = lerp(u, grad2D(aa, xf, yf), grad2D(ba, xf - 1, yf));
  const x2 = lerp(u, grad2D(ab, xf, yf - 1), grad2D(bb, xf - 1, yf - 1));
  return lerp(v, x1, x2);
}

/**
 * Fractal Brownian Motion (FBM) noise
 */
function fbm(x, y, octaves = 4, lacunarity = 2, persistence = 0.5) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += perlin2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxValue;
}

/**
 * Turbulence noise (absolute value FBM)
 */
function turbulence(x, y, octaves = 4) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += Math.abs(perlin2D(x * frequency, y * frequency)) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / maxValue;
}

/**
 * Ridged noise
 */
function ridged(x, y, octaves = 4) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    const value = 1 - Math.abs(perlin2D(x * frequency, y * frequency));
    total += value * value * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / maxValue;
}

/**
 * Voronoi/Worley noise
 */
function voronoi(x, y, scale = 1, seed = 0) {
  const sx = x * scale;
  const sy = y * scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);

  let minDist = 2;

  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const hash = P[(P[(cx & 255) + seed] + (cy & 255)) & 255];
      const px = cx + (hash / 255);
      const py = cy + (P[(hash + 1) & 255] / 255);
      const dx = sx - px;
      const dy = sy - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
      }
    }
  }

  return Math.min(minDist, 1);
}

/**
 * Generate a noise map for a tile
 */
function generateNoiseMap(width, height, scale = 0.15, offsetX = 0, offsetY = 0, type = 'fbm') {
  const map = new Float32Array(width * height);
  const noiseFn = {
    perlin: (x, y) => (perlin2D(x, y) + 1) / 2,
    fbm: (x, y) => (fbm(x, y) + 1) / 2,
    turbulence: turbulence,
    ridged: ridged,
    voronoi: (x, y) => voronoi(x, y, 1, 0)
  }[type] || ((x, y) => (fbm(x, y) + 1) / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + offsetX) * scale;
      const ny = (y + offsetY) * scale;
      map[y * width + x] = noiseFn(nx, ny);
    }
  }

  return map;
}

/**
 * Create a simple pseudo-random number generator with seed
 */
function createSeededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

module.exports = {
  perlin2D,
  fbm,
  turbulence,
  ridged,
  voronoi,
  generateNoiseMap,
  createSeededRandom
};
