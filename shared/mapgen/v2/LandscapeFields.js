import { elevationLevelToNormalized } from '../../terrain.js';
import {
  V2_QUANTIZATION_SCALE,
  coordinateHash32,
  deriveStreamSeed,
  dequantizeFixed,
  quantizeFixed
} from './Determinism.js';
import { deepFreeze } from './V2Context.js';

const SCALE = V2_QUANTIZATION_SCALE;
const DIRECTIONS = Object.freeze([
  { dx: 1, dy: 0, direction: 'e', opposite: 'w' },
  { dx: 0, dy: 1, direction: 's', opposite: 'n' }
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerpFixed(a, b, t) {
  return quantizeFixed(
    dequantizeFixed(a) +
    (dequantizeFixed(b) - dequantizeFixed(a)) * dequantizeFixed(t)
  );
}

function fadeFixed(value) {
  const t = dequantizeFixed(value);
  return quantizeFixed(t * t * (3 - 2 * t));
}

function latticeValue(seed, x, y, salt) {
  const unsigned = coordinateHash32(seed, x, y, salt);
  return Math.floor((unsigned * (2 * SCALE + 1)) / 0x100000000) - SCALE;
}

/**
 * Fixed-boundary value noise. Coordinates are fixed-point tile coordinates.
 */
function sampleValueNoise(seed, xFixed, yFixed, salt) {
  const x0 = Math.floor(xFixed / SCALE);
  const y0 = Math.floor(yFixed / SCALE);
  const tx = fadeFixed(xFixed - x0 * SCALE);
  const ty = fadeFixed(yFixed - y0 * SCALE);
  const top = lerpFixed(
    latticeValue(seed, x0, y0, salt),
    latticeValue(seed, x0 + 1, y0, salt),
    tx
  );
  const bottom = lerpFixed(
    latticeValue(seed, x0, y0 + 1, salt),
    latticeValue(seed, x0 + 1, y0 + 1, salt),
    tx
  );
  return lerpFixed(top, bottom, ty);
}

function profileFrequencyScale(profile) {
  if (profile === 'compact') return 1_350_000;
  if (profile === 'large') return 820_000;
  return SCALE;
}

function fractalNoise({
  seed,
  x,
  y,
  salt,
  baseFrequency,
  octaves,
  persistence,
  profile,
  warpX = 0,
  warpY = 0
}) {
  const profileScale = profileFrequencyScale(profile);
  let frequency = Math.floor(baseFrequency * profileScale / SCALE);
  let amplitude = SCALE;
  let amplitudeSum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const xFixed = x * frequency + warpX;
    const yFixed = y * frequency + warpY;
    const value = sampleValueNoise(seed, xFixed, yFixed, `${salt}:${octave}`);
    total += Math.floor(value * amplitude / SCALE);
    amplitudeSum += amplitude;
    amplitude = Math.max(1, Math.floor(amplitude * persistence / SCALE));
    frequency *= 2;
  }
  return clamp(Math.round(total * SCALE / amplitudeSum), -SCALE, SCALE);
}

function fieldSeed(attemptSeed, name) {
  return deriveStreamSeed(attemptSeed, `field:${name}`);
}

function createGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(0));
}

function coordinateSequence(width, height, scanOrder) {
  const result = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) result.push({ x, y });
  }
  if (scanOrder === 'reverse') result.reverse();
  else if (scanOrder !== 'row-major') {
    throw new TypeError(`Unsupported landscape field scan order: ${scanOrder}`);
  }
  return result;
}

/**
 * Produce independently salted but intentionally correlated landscape fields.
 * Every published value is a fixed-point integer in [-1_000_000, 1_000_000].
 */
export function generateLandscapeFieldSet({
  width,
  height,
  attemptSeed,
  recipe,
  feasibility,
  scanOrder = 'row-major'
}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('LandscapeFieldSet requires positive integer width and height');
  }
  if (!recipe?.fields || !feasibility?.dimensions?.profile) {
    throw new TypeError('LandscapeFieldSet requires a resolved recipe and feasibility profile');
  }
  const names = [
    'height', 'moisture', 'roughness', 'detail', 'disturbance', 'warpX', 'warpY'
  ];
  const grids = Object.fromEntries(names.map(name => [name, createGrid(width, height)]));
  const seeds = Object.fromEntries(names.map(name => [name, fieldSeed(attemptSeed, name)]));
  const parameters = recipe.fields;
  const common = {
    baseFrequency: parameters.baseFrequency,
    octaves: parameters.octaves,
    persistence: parameters.persistence,
    profile: feasibility.dimensions.profile
  };

  for (const { x, y } of coordinateSequence(width, height, scanOrder)) {
    const rawWarpX = fractalNoise({
      ...common, seed: seeds.warpX, x, y, salt: 'warp-x', octaves: 2
    });
    const rawWarpY = fractalNoise({
      ...common, seed: seeds.warpY, x, y, salt: 'warp-y', octaves: 2
    });
    const warpX = Math.floor(rawWarpX * parameters.warpStrength / SCALE);
    const warpY = Math.floor(rawWarpY * parameters.warpStrength / SCALE);
    grids.warpX[y][x] = warpX;
    grids.warpY[y][x] = warpY;

    const baseHeight = fractalNoise({
      ...common, seed: seeds.height, x, y, salt: 'height', warpX, warpY
    });
    const ridgeNoise = fractalNoise({
      ...common,
      seed: seeds.height,
      x,
      y,
      salt: 'ridge',
      warpX: -warpY,
      warpY: warpX,
      octaves: Math.max(2, parameters.octaves - 1)
    });
    const ridge = SCALE - Math.abs(ridgeNoise);
    grids.height[y][x] = clamp(
      Math.floor(
        baseHeight * (SCALE - parameters.ridgeStrength) / SCALE +
        (ridge - SCALE / 2) * parameters.ridgeStrength / SCALE
      ),
      -SCALE,
      SCALE
    );

    const rawMoisture = fractalNoise({
      ...common, seed: seeds.moisture, x, y, salt: 'moisture', warpX, warpY
    });
    grids.moisture[y][x] = clamp(
      Math.floor(rawMoisture * 780_000 / SCALE - grids.height[y][x] * 220_000 / SCALE),
      -SCALE,
      SCALE
    );
    grids.roughness[y][x] = fractalNoise({
      ...common,
      seed: seeds.roughness,
      x,
      y,
      salt: 'roughness',
      baseFrequency: Math.floor(parameters.baseFrequency * 1.7),
      octaves: Math.max(2, parameters.octaves - 1),
      warpX,
      warpY
    });
    grids.detail[y][x] = fractalNoise({
      ...common,
      seed: seeds.detail,
      x,
      y,
      salt: 'detail',
      baseFrequency: parameters.baseFrequency * 3,
      octaves: 2,
      warpX,
      warpY
    });
    grids.disturbance[y][x] = clamp(
      Math.floor(
        fractalNoise({
          ...common,
          seed: seeds.disturbance,
          x,
          y,
          salt: 'disturbance',
          octaves: 3,
          warpX,
          warpY
        }) * 700_000 / SCALE +
        grids.roughness[y][x] * 300_000 / SCALE
      ),
      -SCALE,
      SCALE
    );
  }

  return deepFreeze({
    fieldVersion: 'landscape-fields-v1',
    quantizationScale: SCALE,
    seeds,
    ...grids
  });
}

function smoothHeight(heightField, coreMask, passes) {
  let current = heightField.map(row => [...row]);
  const height = current.length;
  const width = current[0]?.length ?? 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = createGrid(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (coreMask?.[y]?.[x]) {
          next[y][x] = 0;
          continue;
        }
        let total = current[y][x] * 4;
        let weight = 4;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          total += current[ny][nx];
          weight++;
        }
        next[y][x] = Math.round(total / weight);
      }
    }
    current = next;
  }
  return current;
}

function elevationRange(relief) {
  switch (relief) {
    case 'flat': return { minimum: 0, maximum: 0, scale: 0 };
    case 'lowland':
    case 'river-valley': return { minimum: -1, maximum: 1, scale: 1 };
    case 'rolling': return { minimum: -1, maximum: 2, scale: 2 };
    case 'terraced':
    case 'basin': return { minimum: -1, maximum: 2, scale: 2 };
    case 'ridged': return { minimum: -1, maximum: 3, scale: 3 };
    default: throw new TypeError(`Unsupported V2 relief profile: ${relief}`);
  }
}

function clampNeighborTransitions(levels, coreMask) {
  const height = levels.length;
  const width = levels[0]?.length ?? 0;
  const directions = [
    [1, 0], [0, 1], [-1, 0], [0, -1]
  ];
  for (let pass = 0; pass < width + height; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const difference = levels[ny][nx] - levels[y][x];
          if (Math.abs(difference) <= 1) continue;
          if (coreMask?.[ny]?.[nx]) {
            levels[y][x] = levels[ny][nx] - Math.sign(difference);
          } else {
            levels[ny][nx] = levels[y][x] + Math.sign(difference);
          }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function buildConnectionCandidates(discreteElevation) {
  const height = discreteElevation.length;
  const width = discreteElevation[0]?.length ?? 0;
  const candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const direction of DIRECTIONS) {
        const nx = x + direction.dx;
        const ny = y + direction.dy;
        if (nx >= width || ny >= height) continue;
        const delta = discreteElevation[ny][nx] - discreteElevation[y][x];
        if (delta === 0) continue;
        const edgeId = `elevation-edge:${x}:${y}:${direction.direction}`;
        const reverseId = `${edgeId}:reverse`;
        const kind = Math.abs(delta) === 1 ? 'slope' : 'cliff';
        candidates.push({
          id: edgeId,
          reciprocalId: reverseId,
          from: { x, y },
          to: { x: nx, y: ny },
          direction: direction.direction,
          elevationDelta: delta,
          kind
        });
        candidates.push({
          id: reverseId,
          reciprocalId: edgeId,
          from: { x: nx, y: ny },
          to: { x, y },
          direction: direction.opposite,
          elevationDelta: -delta,
          kind
        });
      }
    }
  }
  return candidates;
}

/**
 * Condition coherent working height around protected spawn cores and publish
 * normalized public elevation plus scan-order-independent reciprocal candidates.
 */
export function generateCoherentElevation({
  fields,
  recipe,
  spawnLayout,
  smoothingPasses = 2
}) {
  const raw = fields?.height;
  if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) {
    throw new TypeError('generateCoherentElevation requires LandscapeFieldSet.height');
  }
  const height = raw.length;
  const width = raw[0].length;
  const coreMask = spawnLayout?.coreMask ?? createGrid(width, height).map(
    row => row.map(() => false)
  );
  const distance = spawnLayout?.distanceToProtectedZone;
  const featherRadius = spawnLayout?.featherRadius ?? 0;
  const conditioned = raw.map((row, y) => row.map((value, x) => {
    if (coreMask[y]?.[x]) return 0;
    if (!distance || featherRadius <= 0 || distance[y][x] >= featherRadius) return value;
    return Math.round(value * distance[y][x] / featherRadius);
  }));
  const continuousElevation = smoothHeight(conditioned, coreMask, smoothingPasses);
  const range = elevationRange(recipe.relief);
  const discreteElevation = continuousElevation.map((row, y) => row.map((value, x) => {
    if (coreMask[y]?.[x] || range.scale === 0) return 0;
    const level = Math.round(value * range.scale / SCALE);
    return clamp(level, range.minimum, range.maximum);
  }));
  clampNeighborTransitions(discreteElevation, coreMask);
  const elevation = discreteElevation.map(row => row.map(elevationLevelToNormalized));
  const connectionCandidates = buildConnectionCandidates(discreteElevation);

  return deepFreeze({
    continuousElevation,
    discreteElevation,
    elevation,
    connectionCandidates
  });
}

