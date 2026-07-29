import { V2_QUANTIZATION_SCALE } from './Determinism.js';
import { deepFreeze } from './V2Context.js';

const SCALE = V2_QUANTIZATION_SCALE;
const CARDINAL = Object.freeze([
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: -1, dy: 0 })
]);
const SURROUNDING = Object.freeze([
  Object.freeze({ dx: -1, dy: -1 }),
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: -1 }),
  Object.freeze({ dx: -1, dy: 0 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: -1, dy: 1 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 1, dy: 1 })
]);

function band(kind, material, enter, retain, weights, bias = 0) {
  return Object.freeze({ kind, material, enter, retain, weights: Object.freeze(weights), bias });
}

function profile(defaultKind, defaultMaterial, bands, { cellular = false } = {}) {
  return Object.freeze({
    defaultKind,
    defaultMaterial,
    bands: Object.freeze(bands),
    cellular
  });
}

/*
 * Region profiles are deliberately closed by node type. Materials are limited
 * to each recipe's declared palette; hydrology and route materials are applied
 * by later stages.
 */
const REGION_PROFILES = Object.freeze({
  forest: profile('meadow', 'grass', [
    band('grove', 'forest', 180_000, 20_000, { moisture: 600_000, disturbance: -400_000 }),
    band('outcrop', 'rock', 330_000, 160_000, { roughness: 650_000, height: 350_000 }),
    band('forest-floor', 'dirt', 80_000, -20_000, { disturbance: 550_000, moisture: 200_000 })
  ]),
  elven_grove: profile('sacred-meadow', 'grass', [
    band('ancient-grove', 'forest', 80_000, -80_000, { moisture: 650_000, disturbance: -350_000 }),
    band('mossy-outcrop', 'rock', 330_000, 160_000, { roughness: 600_000, height: 400_000 }),
    band('leaf-floor', 'dirt', 180_000, 20_000, { disturbance: 450_000, moisture: 300_000 })
  ]),
  plains: profile('grassland', 'grass', [
    band('scrub', 'forest', 250_000, 80_000, { moisture: 550_000, disturbance: -450_000 }),
    band('rocky-rise', 'rock', 330_000, 160_000, { roughness: 550_000, height: 450_000 }),
    band('worn-ground', 'dirt', 220_000, 50_000, { disturbance: 700_000, moisture: -150_000 })
  ]),
  swamp: profile('wet-meadow', 'grass', [
    band('marsh', 'dirt', 120_000, -70_000, { moisture: 800_000, height: -200_000 }),
    band('swamp-grove', 'forest', 260_000, 90_000, { moisture: 600_000, disturbance: -400_000 }),
    band('hummock', 'rock', 520_000, 350_000, { height: 450_000, roughness: 550_000 })
  ]),
  mountain: profile('mountain-floor', 'stone', [
    // Mountain fields are deliberately broad and coherent. A low hysteresis
    // threshold lets a single ridge seed claim most of a 32x32 map, leaving no
    // candidate able to satisfy the recipe's navigable-area contract.
    band('ridge', 'rock', 295_000, 125_000, { height: 600_000, roughness: 400_000 }),
    band('alpine-shelf', 'grass', 330_000, 160_000, { moisture: 450_000, roughness: -250_000, height: 300_000 }),
    band('talus', 'cliff', 500_000, 330_000, { roughness: 750_000, height: 250_000 })
  ]),
  volcano: profile('ash-field', 'stone', [
    band('volcanic-ridge', 'rock', 200_000, 20_000, { height: 550_000, roughness: 450_000 }),
    band('ash-deposit', 'dirt', 300_000, 130_000, { disturbance: 650_000, height: -200_000 }),
    band('basalt-face', 'cliff', 520_000, 350_000, { roughness: 800_000, height: 200_000 })
  ]),
  cave: profile('cavern-floor', 'stone', [
    // Cellular refinement grows and closes solid boundaries after classification.
    // Seed rock conservatively so that refinement produces cavern walls without
    // consuming the recipe's required navigable floor area.
    band('cave-solid', 'rock', 220_000, 50_000, { roughness: 550_000, height: 450_000 }),
    band('damp-floor', 'dirt', 280_000, 100_000, { moisture: 750_000, roughness: -250_000 }),
    band('broken-floor', 'rock', 520_000, 350_000, { disturbance: 550_000, roughness: 450_000 })
  ], { cellular: true }),
  dwarven_mine: profile('mine-floor', 'stone', [
    // Cellular closure expands this seed mask for two passes. Keep the initial
    // mine walls sparse enough to preserve the subterranean usable-area
    // contract while retaining larger excavated rock masses.
    band('mine-solid', 'rock', 180_000, 0, { roughness: 600_000, height: 400_000 }),
    band('excavated-floor', 'dirt', 260_000, 90_000, { disturbance: 700_000, roughness: -200_000 }),
    band('ore-face', 'rock', 560_000, 390_000, { detail: 500_000, roughness: 500_000 })
  ], { cellular: true }),
  bridge: profile('river-approach', 'grass', [
    band('embankment', 'stone', 350_000, 180_000, { height: 600_000, roughness: 400_000 }),
    band('worn-approach', 'dirt', 280_000, 100_000, { disturbance: 750_000, moisture: -250_000 })
  ]),
  castle: profile('courtyard', 'stone', [
    band('weathered-court', 'dirt', 330_000, 160_000, { disturbance: 650_000, moisture: 150_000 }),
    band('overgrown-edge', 'grass', 370_000, 200_000, { moisture: 550_000, disturbance: -450_000 })
  ]),
  dungeon: profile('dungeon-floor', 'stone', [
    band('broken-masonry', 'rock', 440_000, 270_000, { roughness: 550_000, disturbance: 450_000 }),
    // Keep compact constructed maps responsive to their coherent fields. The
    // former threshold commonly collapsed all attempts to one stone region.
    band('earthen-seam', 'dirt', 50_000, -100_000, { moisture: 450_000, disturbance: 350_000 })
  ]),
  arena: profile('arena-floor', 'stone', [
    band('worn-arena', 'dirt', 40_000, -100_000, { disturbance: 800_000, roughness: -200_000 }),
    band('arena-edge', 'grass', 160_000, 0, { moisture: 500_000, disturbance: -500_000 })
  ]),
  guild: profile('proving-ground', 'stone', [
    band('worn-ground', 'dirt', 340_000, 170_000, { disturbance: 750_000, roughness: -250_000 }),
    band('training-verge', 'grass', 430_000, 260_000, { moisture: 500_000, disturbance: -500_000 })
  ]),
  vampiric_crypt: profile('crypt-floor', 'stone', [
    band('collapsed-crypt', 'rock', 450_000, 280_000, { roughness: 600_000, disturbance: 400_000 }),
    band('damp-crypt', 'dirt', 80_000, -80_000, { moisture: 650_000, height: -200_000 })
  ]),
  orcish_warcamp: profile('camp-ground', 'dirt', [
    band('defensive-rise', 'rock', 430_000, 260_000, { height: 500_000, roughness: 500_000 }),
    band('trampled-verge', 'grass', 390_000, 220_000, { moisture: 400_000, disturbance: -600_000 })
  ]),
  human_ruins: profile('ruined-court', 'stone', [
    band('rubble-field', 'rock', 440_000, 270_000, { roughness: 550_000, disturbance: 450_000 }),
    band('overgrown-ruin', 'grass', 300_000, 130_000, { moisture: 600_000, disturbance: -400_000 })
  ])
});

function createGrid(width, height, value) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => (
      typeof value === 'function' ? value() : value
    ))
  );
}

function coordinates(width, height, scanOrder) {
  const values = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) values.push({ x, y });
  }
  if (scanOrder === 'reverse') values.reverse();
  else if (scanOrder !== 'row-major') {
    throw new TypeError(`Unsupported region scan order: ${String(scanOrder)}`);
  }
  return values;
}

function assertDimensions(grid, name, width, height, cellPredicate) {
  if (!Array.isArray(grid) || grid.length !== height) {
    throw new TypeError(`${name} must contain exactly ${height} rows`);
  }
  grid.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new TypeError(`${name}[${y}] must contain exactly ${width} cells`);
    }
    row.forEach((value, x) => {
      if (!cellPredicate(value)) {
        throw new TypeError(`${name}[${y}][${x}] contains an invalid value`);
      }
    });
  });
}

function assertInputs({ width, height, recipe, fields, spawnLayout, priorMask, structuredOverlays }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('Terrain regions require positive integer width and height');
  }
  if (!recipe || typeof recipe !== 'object' || !Object.hasOwn(REGION_PROFILES, recipe.nodeType)) {
    throw new TypeError(`No explicit V2 region profile for ${String(recipe?.nodeType)}`);
  }
  if (!Number.isInteger(recipe.regions?.minimumRegionArea) ||
      recipe.regions.minimumRegionArea < 1) {
    throw new TypeError('Recipe minimumRegionArea must be a positive integer');
  }
  for (const name of ['height', 'moisture', 'roughness', 'detail', 'disturbance']) {
    assertDimensions(
      fields?.[name],
      `fields.${name}`,
      width,
      height,
      value => Number.isSafeInteger(value) && value >= -SCALE && value <= SCALE
    );
  }
  assertDimensions(
    spawnLayout?.coreMask,
    'spawnLayout.coreMask',
    width,
    height,
    value => typeof value === 'boolean'
  );
  if (priorMask !== undefined) {
    assertDimensions(priorMask, 'priorMask', width, height, value => typeof value === 'boolean');
  }
  if (!Array.isArray(structuredOverlays)) {
    throw new TypeError('structuredOverlays must be an array');
  }
}

function scoreBand(spec, fields, x, y) {
  let score = spec.bias;
  for (const [name, weight] of Object.entries(spec.weights)) {
    score += Math.trunc(fields[name][y][x] * weight / SCALE);
  }
  return score;
}

function chooseStrongBand(profileDefinition, fields, x, y, bandCount) {
  let choice = null;
  profileDefinition.bands.slice(0, bandCount - 1).forEach((spec, priority) => {
    const score = scoreBand(spec, fields, x, y);
    if (score < spec.enter) return;
    const margin = score - spec.enter;
    if (choice === null || margin > choice.margin ||
        (margin === choice.margin && priority < choice.priority)) {
      choice = { spec, priority, score, margin };
    }
  });
  return choice;
}

function cellKey(cell) {
  return `${cell.kind}\u0000${cell.material}\u0000${cell.parentFeatureId ?? ''}`;
}

function defaultCell(profileDefinition) {
  return {
    kind: profileDefinition.defaultKind,
    material: profileDefinition.defaultMaterial,
    parentFeatureId: null,
    authored: false
  };
}

function classifyWithHysteresis({ width, height, fields, profileDefinition, bandCount, scanOrder }) {
  const result = createGrid(width, height, () => defaultCell(profileDefinition));
  const scores = profileDefinition.bands.map(() => createGrid(width, height, Number.MIN_SAFE_INTEGER));
  const claimed = createGrid(width, height, -1);
  const seedMask = createGrid(width, height, false);

  for (const { x, y } of coordinates(width, height, scanOrder)) {
    profileDefinition.bands.slice(0, bandCount - 1).forEach((spec, index) => {
      scores[index][y][x] = scoreBand(spec, fields, x, y);
    });
    const choice = chooseStrongBand(profileDefinition, fields, x, y, bandCount);
    if (!choice) continue;
    claimed[y][x] = choice.priority;
    seedMask[y][x] = true;
  }

  let changed = true;
  while (changed) {
    changed = false;
    const next = claimed.map(row => [...row]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (claimed[y][x] >= 0) continue;
        const candidates = new Set();
        for (const { dx, dy } of CARDINAL) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (claimed[ny][nx] >= 0) candidates.add(claimed[ny][nx]);
        }
        const ordered = [...candidates].filter(index =>
          scores[index][y][x] >= profileDefinition.bands[index].retain
        ).sort((a, b) => {
          const aMargin = scores[a][y][x] - profileDefinition.bands[a].retain;
          const bMargin = scores[b][y][x] - profileDefinition.bands[b].retain;
          return bMargin - aMargin || a - b;
        });
        if (ordered.length > 0) {
          next[y][x] = ordered[0];
          changed = true;
        }
      }
    }
    for (let y = 0; y < height; y++) claimed[y] = next[y];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = claimed[y][x];
      if (index < 0) continue;
      const spec = profileDefinition.bands[index];
      result[y][x] = {
        kind: spec.kind,
        material: spec.material,
        parentFeatureId: null,
        authored: false
      };
    }
  }
  return { classification: result, seedMask };
}

/**
 * Synchronous cellular refinement. The caller must supply the meaningful prior
 * solid mask; this helper never invents an unrelated random starting state.
 */
export function refineMaskWithCellularAutomata({
  priorMask,
  protectedMask,
  passes = 2,
  birthThreshold = 5,
  survivalThreshold = 4
}) {
  const height = priorMask?.length ?? 0;
  const width = priorMask?.[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new TypeError('CA priorMask cannot be empty');
  assertDimensions(priorMask, 'priorMask', width, height, value => typeof value === 'boolean');
  assertDimensions(
    protectedMask,
    'protectedMask',
    width,
    height,
    value => typeof value === 'boolean'
  );
  if (!Number.isInteger(passes) || passes < 0 || passes > 8) {
    throw new RangeError('CA passes must be an integer from 0 to 8');
  }
  let current = priorMask.map(row => [...row]);
  for (let pass = 0; pass < passes; pass++) {
    const next = createGrid(width, height, false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (protectedMask[y][x]) continue;
        let neighbors = 0;
        for (const { dx, dy } of SURROUNDING) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || current[ny][nx]) {
            neighbors++;
          }
        }
        next[y][x] = current[y][x]
          ? neighbors >= survivalThreshold
          : neighbors >= birthThreshold;
      }
    }
    current = next;
  }
  return current;
}

function applyCellularRefinement({
  classification,
  profileDefinition,
  generatedPriorMask,
  suppliedPriorMask,
  protectedMask
}) {
  if (!profileDefinition.cellular) return classification;
  const priorMask = suppliedPriorMask ?? generatedPriorMask;
  const refined = refineMaskWithCellularAutomata({ priorMask, protectedMask });
  const solid = profileDefinition.bands[0];
  return classification.map((row, y) => row.map((cell, x) => {
    if (protectedMask[y][x]) return defaultCell(profileDefinition);
    if (refined[y][x]) {
      return {
        kind: solid.kind,
        material: solid.material,
        parentFeatureId: null,
        authored: false
      };
    }
    if (cell.kind === solid.kind) return defaultCell(profileDefinition);
    return cell;
  }));
}

function validateOverlay(overlay, width, height) {
  const allowed = ['id', 'kind', 'material', 'cells', 'parentFeatureId'];
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay) ||
      Object.keys(overlay).some(key => !allowed.includes(key)) ||
      !allowed.every(key => Object.hasOwn(overlay, key))) {
    throw new TypeError('Each structured overlay must be a closed id/kind/material/cells/parentFeatureId record');
  }
  for (const name of ['id', 'kind', 'material']) {
    if (typeof overlay[name] !== 'string' || overlay[name].length === 0) {
      throw new TypeError(`Structured overlay ${name} must be a non-empty string`);
    }
  }
  if (overlay.parentFeatureId !== null &&
      (typeof overlay.parentFeatureId !== 'string' || overlay.parentFeatureId.length === 0)) {
    throw new TypeError('Structured overlay parentFeatureId must be null or a non-empty string');
  }
  if (!Array.isArray(overlay.cells) || overlay.cells.length === 0) {
    throw new TypeError(`Structured overlay ${overlay.id} must contain cells`);
  }
  overlay.cells.forEach((cell, index) => {
    if (cell === null || typeof cell !== 'object' || Array.isArray(cell) ||
        Object.keys(cell).length !== 2 || !Object.hasOwn(cell, 'x') || !Object.hasOwn(cell, 'y') ||
        !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
        cell.x < 0 || cell.x >= width || cell.y < 0 || cell.y >= height) {
      throw new TypeError(`Structured overlay ${overlay.id} cell ${index} is invalid`);
    }
  });
}

/**
 * Apply authored geometry in stable ID order. Overlap is rejected rather than
 * silently giving one authored feature precedence.
 */
export function applyStructuredRegionOverlays({
  classification,
  structuredOverlays,
  protectedMask
}) {
  const height = classification?.length ?? 0;
  const width = classification?.[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new TypeError('classification cannot be empty');
  assertDimensions(
    protectedMask,
    'protectedMask',
    width,
    height,
    value => typeof value === 'boolean'
  );
  const result = classification.map(row => row.map(cell => ({ ...cell })));
  const occupied = new Set();
  const ids = new Set();
  for (const overlay of [...structuredOverlays].sort((a, b) =>
    String(a?.id).localeCompare(String(b?.id))
  )) {
    validateOverlay(overlay, width, height);
    if (ids.has(overlay.id)) throw new TypeError(`Duplicate structured overlay id: ${overlay.id}`);
    ids.add(overlay.id);
    const sortedCells = [...overlay.cells].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const { x, y } of sortedCells) {
      const key = `${x},${y}`;
      if (occupied.has(key)) throw new TypeError(`Structured overlays overlap at ${key}`);
      if (protectedMask[y][x]) {
        throw new TypeError(`Structured overlay ${overlay.id} intersects protected spawn core at ${key}`);
      }
      occupied.add(key);
      result[y][x] = {
        kind: overlay.kind,
        material: overlay.material,
        parentFeatureId: overlay.parentFeatureId,
        authored: true
      };
    }
  }
  return result;
}

function discoverComponents(classification) {
  const height = classification.length;
  const width = classification[0].length;
  const visited = createGrid(width, height, false);
  const components = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x]) continue;
      const key = cellKey(classification[y][x]);
      const queue = [{ x, y }];
      const cells = [];
      visited[y][x] = true;
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        cells.push(current);
        for (const { dx, dy } of CARDINAL) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ny][nx]) continue;
          if (cellKey(classification[ny][nx]) !== key) continue;
          visited[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
      cells.sort((a, b) => a.y - b.y || a.x - b.x);
      components.push({
        key,
        cells,
        anchor: cells[0],
        authored: cells.some(cell => classification[cell.y][cell.x].authored),
        protected: cells.some(cell => classification[cell.y][cell.x].protected)
      });
    }
  }
  return components.sort((a, b) =>
    a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x || a.key.localeCompare(b.key)
  );
}

function cleanupSmallComponents(classification, minimumRegionArea) {
  const height = classification.length;
  const width = classification[0].length;
  const maximumMerges = width * height;
  for (let merge = 0; merge < maximumMerges; merge++) {
    const components = discoverComponents(classification);
    const componentAt = createGrid(width, height, -1);
    components.forEach((component, index) => {
      component.cells.forEach(({ x, y }) => {
        componentAt[y][x] = index;
      });
    });
    const sourceIndex = components.findIndex(component =>
      component.cells.length < minimumRegionArea && !component.authored && !component.protected
    );
    if (sourceIndex < 0) return classification;
    const source = components[sourceIndex];
    const contacts = new Map();
    for (const { x, y } of source.cells) {
      for (const { dx, dy } of CARDINAL) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const targetIndex = componentAt[ny][nx];
        if (targetIndex === sourceIndex) continue;
        const target = components[targetIndex];
        if (target.authored) continue;
        contacts.set(targetIndex, (contacts.get(targetIndex) ?? 0) + 1);
      }
    }
    const targets = [...contacts.entries()].sort(([aIndex, aContacts], [bIndex, bContacts]) => {
      const a = components[aIndex];
      const b = components[bIndex];
      return bContacts - aContacts ||
        b.cells.length - a.cells.length ||
        a.anchor.y - b.anchor.y ||
        a.anchor.x - b.anchor.x ||
        a.key.localeCompare(b.key);
    });
    if (targets.length === 0) return classification;
    const targetCell = classification[
      components[targets[0][0]].anchor.y
    ][components[targets[0][0]].anchor.x];
    source.cells.forEach(({ x, y }) => {
      classification[y][x] = { ...targetCell, authored: false, protected: false };
    });
  }
  throw new Error('Region minimum-size cleanup did not converge');
}

function describeSeedRegions(seedMask, classification) {
  const seedClassification = classification.map((row, y) => row.map((cell, x) =>
    seedMask[y][x]
      ? cell
      : { kind: '__not-seed__', material: '__not-seed__', parentFeatureId: null }
  ));
  return discoverComponents(seedClassification)
    .filter(component => component.key !== '__not-seed__\u0000__not-seed__\u0000')
    .map(component => {
      const first = classification[component.anchor.y][component.anchor.x];
      const xs = component.cells.map(cell => cell.x);
      const ys = component.cells.map(cell => cell.y);
      return {
        id: `seed:${first.kind}:${component.anchor.x}:${component.anchor.y}`,
        kind: first.kind,
        material: first.material,
        anchor: { ...component.anchor },
        bounds: {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys)
        },
        area: component.cells.length
      };
    });
}

function materializeRegions(classification) {
  const height = classification.length;
  const width = classification[0].length;
  const components = discoverComponents(classification);
  const regionIdGrid = createGrid(width, height, null);
  const records = components.map(component => {
    const first = classification[component.anchor.y][component.anchor.x];
    const id = `region:${first.kind}:${component.anchor.x}:${component.anchor.y}`;
    component.cells.forEach(({ x, y }) => {
      regionIdGrid[y][x] = id;
    });
    const xs = component.cells.map(cell => cell.x);
    const ys = component.cells.map(cell => cell.y);
    return {
      id,
      kind: first.kind,
      material: first.material,
      bounds: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      },
      area: component.cells.length,
      adjacentRegionIds: [],
      parentFeatureId: first.parentFeatureId
    };
  });
  const recordById = new Map(records.map(record => [record.id, record]));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const { dx, dy } of CARDINAL.slice(0, 2)) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const a = regionIdGrid[y][x];
        const b = regionIdGrid[ny][nx];
        if (a === b) continue;
        recordById.get(a).adjacentRegionIds.push(b);
        recordById.get(b).adjacentRegionIds.push(a);
      }
    }
  }
  records.forEach(record => {
    record.adjacentRegionIds = [...new Set(record.adjacentRegionIds)].sort();
  });
  return { regions: records, regionIdGrid };
}

/**
 * Compile coherent fields into a complete four-neighbor region partition.
 *
 * `regions` are directly compatible with `BattleMapV2.features.regions`.
 * `materialGrid` and `regionIdGrid` are the authoritative inputs used by the
 * later terrain/hydrology/route stages. `seedRegions` is diagnostic evidence
 * of the strong hysteresis seeds, not a BattleMapV2 feature collection.
 */
export function generateTerrainRegions({
  width,
  height,
  recipe,
  fields,
  spawnLayout,
  priorMask,
  structuredOverlays = [],
  scanOrder = 'row-major'
}) {
  assertInputs({
    width,
    height,
    recipe,
    fields,
    spawnLayout,
    priorMask,
    structuredOverlays
  });
  const profileDefinition = REGION_PROFILES[recipe.nodeType];
  const bandCount = recipe.regions.materialBandCount;
  if (!Number.isInteger(bandCount) || bandCount < 1 ||
      bandCount > profileDefinition.bands.length + 1) {
    throw new RangeError(
      `Recipe materialBandCount ${String(bandCount)} is unsupported by ${recipe.nodeType}`
    );
  }
  const hysteresis = classifyWithHysteresis({
    width,
    height,
    fields,
    profileDefinition,
    bandCount,
    scanOrder
  });
  const generatedPriorMask = hysteresis.classification.map(row =>
    row.map(cell => cell.kind === profileDefinition.bands[0]?.kind)
  );
  let classification = applyCellularRefinement({
    classification: hysteresis.classification,
    profileDefinition,
    generatedPriorMask,
    suppliedPriorMask: priorMask,
    protectedMask: spawnLayout.coreMask
  });

  classification = classification.map((row, y) => row.map((cell, x) =>
    spawnLayout.coreMask[y][x]
      ? { ...defaultCell(profileDefinition), authored: false, protected: true }
      : { ...cell, protected: false }
  ));
  classification = applyStructuredRegionOverlays({
    classification,
    structuredOverlays,
    protectedMask: spawnLayout.coreMask
  });
  classification = cleanupSmallComponents(
    classification,
    recipe.regions.minimumRegionArea
  );

  const { regions, regionIdGrid } = materializeRegions(classification);
  const materialGrid = classification.map(row => row.map(cell => cell.material));
  const kindGrid = classification.map(row => row.map(cell => cell.kind));
  const parentFeatureIdGrid = classification.map(row =>
    row.map(cell => cell.parentFeatureId)
  );
  const seedRegions = describeSeedRegions(
    hysteresis.seedMask,
    hysteresis.classification
  );

  return deepFreeze({
    regionVersion: 'terrain-regions-v1',
    classifierId: `regions:${recipe.nodeType}:v1`,
    minimumRegionArea: recipe.regions.minimumRegionArea,
    materialGrid,
    kindGrid,
    regionIdGrid,
    parentFeatureIdGrid,
    regions,
    seedRegions
  });
}
