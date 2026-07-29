import {
  coordinateHash32,
  deriveStreamSeed,
  stableLexicographicCompare
} from './Determinism.js';
import { deepFreeze } from './V2Context.js';

const SCALE = 1_000_000;
const DIRECTION_BITS = Object.freeze({
  n: 1,
  e: 2,
  s: 4,
  w: 8
});
const DIRECTIONS = Object.freeze([
  Object.freeze({ name: 'n', bit: DIRECTION_BITS.n, dx: 0, dy: -1 }),
  Object.freeze({ name: 'e', bit: DIRECTION_BITS.e, dx: 1, dy: 0 }),
  Object.freeze({ name: 's', bit: DIRECTION_BITS.s, dx: 0, dy: 1 }),
  Object.freeze({ name: 'w', bit: DIRECTION_BITS.w, dx: -1, dy: 0 })
]);
const CONNECTION_KINDS = new Map([
  ['ramp', 'slope'],
  ['slope', 'slope'],
  ['long_ramp', 'slope'],
  ['stairs', 'stairs'],
  ['multi_stairs', 'stairs']
]);
const DECORATION_MODES = Object.freeze({
  'ground-cover': 'moist',
  'leaf-litter': 'overgrowth',
  mushroom: 'moist',
  crystal: 'rough',
  talus: 'rough',
  scrub: 'dry',
  reeds: 'waterside',
  debris: 'disturbed',
  rubble: 'disturbed',
  moss: 'overgrowth',
  ash: 'ash'
});

export const VISUAL_LAYERS_VERSION = 'correlated-visual-layers-v1';

/**
 * Only these overlap classes require an explicit capability declaration.
 * Other overlays compose by their injected integer stratum and precedence.
 */
export const REQUIRED_VISUAL_COMPOSITIONS = deepFreeze([
  { lower: 'shore', upper: 'route' },
  { lower: 'route', upper: 'slope' },
  { lower: 'cliff', upper: 'wetness' },
  { lower: 'decoration', upper: 'prop' }
]);

function makeGrid(width, height, value = false) {
  return Array.from({ length: height }, () => Array(width).fill(value));
}

function assertPositiveDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width <= 0 || height <= 0) {
    throw new TypeError('Visual layers require positive integer width and height');
  }
}

function assertGrid(grid, name, width, height, predicate) {
  if (!Array.isArray(grid) || grid.length !== height) {
    throw new TypeError(`${name} must be an exact ${width}x${height} row-major grid`);
  }
  for (let y = 0; y < height; y++) {
    if (!Array.isArray(grid[y]) || grid[y].length !== width) {
      throw new TypeError(`${name} must be an exact ${width}x${height} row-major grid`);
    }
    for (let x = 0; x < width; x++) {
      if (!predicate(grid[y][x])) {
        throw new TypeError(`${name}[${y}][${x}] contains an invalid value`);
      }
    }
  }
  return grid;
}

function optionalBooleanGrid(grid, name, width, height) {
  if (grid === undefined || grid === null) return makeGrid(width, height);
  return assertGrid(
    grid,
    name,
    width,
    height,
    value => typeof value === 'boolean'
  );
}

function combinedMask(width, height, ...masks) {
  const result = makeGrid(width, height);
  for (const mask of masks) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) result[y][x] ||= mask[y][x];
    }
  }
  return result;
}

function coordinateSequence(width, height, scanOrder) {
  const coordinates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) coordinates.push({ x, y });
  }
  if (scanOrder === 'reverse') coordinates.reverse();
  else if (scanOrder !== 'row-major') {
    throw new TypeError(`Unsupported visual-layer scan order: ${String(scanOrder)}`);
  }
  return coordinates;
}

function maskFromPredicate(width, height, predicate) {
  return Array.from(
    { length: height },
    (_, y) => Array.from({ length: width }, (_, x) => Boolean(predicate(x, y)))
  );
}

function directionMask(width, height, x, y, predicate) {
  let mask = 0;
  for (const direction of DIRECTIONS) {
    const nx = x + direction.dx;
    const ny = y + direction.dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    if (predicate(nx, ny, direction)) mask |= direction.bit;
  }
  return mask;
}

function fixed(value, defaultValue = 0) {
  return Number.isSafeInteger(value) ? value : defaultValue;
}

function assertCapabilities(capabilities, recipe) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new TypeError('Visual layers require injected render capabilities');
  }
  if (capabilities.palette !== recipe.renderPalette) {
    throw new Error(
      `Visual capability palette ${String(capabilities.palette)} does not match ` +
      `recipe palette ${String(recipe.renderPalette)}`
    );
  }
  for (const key of ['variants', 'transitions', 'decorations']) {
    if (!capabilities[key] || typeof capabilities[key] !== 'object' ||
        Array.isArray(capabilities[key])) {
      throw new TypeError(`Visual capabilities.${key} must be a keyed record`);
    }
  }
  if (!Array.isArray(capabilities.compositions)) {
    throw new TypeError('Visual capabilities.compositions must be an array');
  }
}

function variantCapability(capabilities, material) {
  const capability = capabilities.variants[material];
  if (!capability) {
    throw new Error(`Missing visual variant capability for material: ${material}`);
  }
  if (!Number.isSafeInteger(capability.count) || capability.count <= 0) {
    throw new TypeError(`Variant capability ${material}.count must be a positive integer`);
  }
  const maximumFraction = capability.maximumFraction ?? SCALE;
  if (!Number.isSafeInteger(maximumFraction) ||
      maximumFraction < Math.ceil(SCALE / capability.count) ||
      maximumFraction > SCALE) {
    throw new RangeError(
      `Variant capability ${material}.maximumFraction cannot be satisfied`
    );
  }
  return { count: capability.count, maximumFraction };
}

function overlayCapability(capabilities, kind) {
  const capability = capabilities.transitions[kind];
  if (!capability) {
    throw new Error(`Missing visual transition capability for kind: ${kind}`);
  }
  if (typeof capability.assetKey !== 'string' || capability.assetKey.length === 0) {
    throw new TypeError(`Transition capability ${kind}.assetKey must be non-empty`);
  }
  if (!['below_prop', 'tile_top', 'exposed_face', 'above_connection']
    .includes(capability.anchor)) {
    throw new TypeError(`Transition capability ${kind}.anchor is invalid`);
  }
  if (!Number.isSafeInteger(capability.stratum) ||
      !Number.isSafeInteger(capability.precedence)) {
    throw new TypeError(
      `Transition capability ${kind} requires integer stratum and precedence`
    );
  }
  return capability;
}

function decorationCapability(capabilities, kind) {
  const capability = capabilities.decorations[kind];
  if (!capability) {
    throw new Error(`Missing visual decoration capability for kind: ${kind}`);
  }
  if (typeof capability.assetKey !== 'string' || capability.assetKey.length === 0) {
    throw new TypeError(`Decoration capability ${kind}.assetKey must be non-empty`);
  }
  if (!Number.isSafeInteger(capability.variantCount) ||
      capability.variantCount <= 0) {
    throw new TypeError(
      `Decoration capability ${kind}.variantCount must be a positive integer`
    );
  }
  if (!['below_prop', 'tile_top', 'exposed_face', 'above_connection']
    .includes(capability.anchor)) {
    throw new TypeError(`Decoration capability ${kind}.anchor is invalid`);
  }
  return capability;
}

function materialGroups(terrain) {
  const groups = new Map();
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < terrain[y].length; x++) {
      const material = terrain[y][x].material;
      const values = groups.get(material) ?? [];
      values.push({ x, y });
      groups.set(material, values);
    }
  }
  return groups;
}

function sourceFeatureAt(evidence, x, y, preference = 'region') {
  const key = `${x},${y}`;
  if (preference === 'route') {
    return evidence.routeFeatureByCell.get(key) ??
      evidence.regionIdGrid[y][x] ??
      null;
  }
  if (preference === 'water') {
    return evidence.waterFeatureByCell.get(key) ??
      evidence.regionIdGrid[y][x] ??
      null;
  }
  return evidence.regionIdGrid[y][x] ?? null;
}

function featureMaps(width, height, regions, hydrology, routes) {
  const waterFeatureByCell = new Map();
  const waterFeatures = [...(hydrology.waterBodies ?? [])].sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
  for (const feature of waterFeatures) {
    for (const cell of feature.cells ?? []) {
      if (cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height) {
        const key = `${cell.x},${cell.y}`;
        if (!waterFeatureByCell.has(key)) waterFeatureByCell.set(key, feature.id);
      }
    }
  }
  const routeFeatureByCell = new Map();
  const routeFeatures = [...(routes.features ??
    (routes.routes ?? []).map(item => item.feature).filter(Boolean))].sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
  for (const feature of routeFeatures) {
    for (const cell of feature.centerline ?? []) {
      if (cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height) {
        const key = `${cell.x},${cell.y}`;
        if (!routeFeatureByCell.has(key)) routeFeatureByCell.set(key, feature.id);
      }
    }
  }
  const waterBandMask = combinedMask(
    width,
    height,
    optionalBooleanGrid(
      hydrology.featureMask ?? hydrology.waterMask,
      'hydrology.featureMask',
      width,
      height
    ),
    optionalBooleanGrid(hydrology.bankMask, 'hydrology.bankMask', width, height),
    optionalBooleanGrid(hydrology.wetnessMask, 'hydrology.wetnessMask', width, height)
  );
  const routeBandMask = combinedMask(
    width,
    height,
    optionalBooleanGrid(
      routes.masks?.centerlineMask,
      'routes.masks.centerlineMask',
      width,
      height
    ),
    optionalBooleanGrid(
      routes.masks?.pathMask,
      'routes.masks.pathMask',
      width,
      height
    ),
    optionalBooleanGrid(
      routes.masks?.shoulderMask,
      'routes.masks.shoulderMask',
      width,
      height
    )
  );
  const fillNearest = (target, mask, features) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (!mask[y][x] || target.has(key)) continue;
        let nearest = null;
        for (const feature of features) {
          for (const cell of feature.cells ?? feature.centerline ?? []) {
            const distance = Math.abs(x - cell.x) + Math.abs(y - cell.y);
            if (!nearest || distance < nearest.distance ||
                (distance === nearest.distance &&
                  String(feature.id).localeCompare(String(nearest.id)) < 0)) {
              nearest = { distance, id: feature.id };
            }
          }
        }
        if (nearest) target.set(key, nearest.id);
      }
    }
  };
  fillNearest(waterFeatureByCell, waterBandMask, waterFeatures);
  fillNearest(routeFeatureByCell, routeBandMask, routeFeatures);
  return {
    regionIdGrid: regions.regionIdGrid,
    waterFeatureByCell,
    routeFeatureByCell
  };
}

function canonicalRecordCompare(left, right) {
  return left.y - right.y ||
    left.x - right.x ||
    (left.stratum ?? 0) - (right.stratum ?? 0) ||
    (left.precedence ?? 0) - (right.precedence ?? 0) ||
    stableLexicographicCompare(
      [left.kind ?? '', left.id],
      [right.kind ?? '', right.id]
    );
}

function chooseVariant({
  seed,
  x,
  y,
  material,
  featureId,
  count,
  fields,
  patchSize
}) {
  if (count === 1) return 0;
  const originPatchX = Math.floor(x / patchSize);
  const originPatchY = Math.floor(y / patchSize);
  let patch = null;
  for (let patchY = originPatchY - 1; patchY <= originPatchY + 1; patchY++) {
    for (let patchX = originPatchX - 1; patchX <= originPatchX + 1; patchX++) {
      const jitterRange = Math.max(1, patchSize);
      const centerX = patchX * patchSize + Math.floor(patchSize / 2) +
        coordinateHash32(seed, patchX, patchY, 'variant-patch:center-x') %
          jitterRange -
        Math.floor(jitterRange / 2);
      const centerY = patchY * patchSize + Math.floor(patchSize / 2) +
        coordinateHash32(seed, patchX, patchY, 'variant-patch:center-y') %
          jitterRange -
        Math.floor(jitterRange / 2);
      const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (!patch || distance < patch.distance ||
          (
            distance === patch.distance &&
            (patchY < patch.y || (patchY === patch.y && patchX < patch.x))
          )) {
        patch = { x: patchX, y: patchY, centerX, centerY, distance };
      }
    }
  }
  const sampleX = Math.max(
    0,
    Math.min(fields.materialDetail[0].length - 1, patch.centerX)
  );
  const sampleY = Math.max(
    0,
    Math.min(fields.materialDetail.length - 1, patch.centerY)
  );
  const patchHash = coordinateHash32(
    seed,
    patch.x,
    patch.y,
    `${material}:${featureId ?? 'none'}`
  );
  const correlatedSignal =
    fixed(fields.materialDetail[sampleY][sampleX]) * 5 +
    fixed(fields.moisture[sampleY][sampleX]) * 2 -
    fixed(fields.disturbance[sampleY][sampleX]) * 2 +
    fixed(fields.roughness[sampleY][sampleX]);
  const signalBand = Math.floor(
    (correlatedSignal + 10 * SCALE) / Math.max(1, Math.floor(5 * SCALE / count))
  );
  return ((patchHash + signalBand) >>> 0) % count;
}

function enforceVariantMaximum(records, capabilities, seed, excluded) {
  const byMaterial = new Map();
  for (const record of records) {
    if (excluded[record.y][record.x]) continue;
    const values = byMaterial.get(record.material) ?? [];
    values.push(record);
    byMaterial.set(record.material, values);
  }
  for (const [material, materialRecords] of byMaterial) {
    const { count, maximumFraction } = variantCapability(capabilities, material);
    if (count === 1) continue;
    const maximum = Math.ceil(materialRecords.length * maximumFraction / SCALE);
    const counts = Array(count).fill(0);
    materialRecords.forEach(record => counts[record.variantIndex]++);
    for (let source = 0; source < count; source++) {
      let surplus = counts[source] - maximum;
      if (surplus <= 0) continue;
      const candidates = materialRecords
        .filter(record => record.variantIndex === source)
        .sort((left, right) =>
          coordinateHash32(seed, left.x, left.y, `rebalance:${material}`) -
            coordinateHash32(seed, right.x, right.y, `rebalance:${material}`) ||
          canonicalRecordCompare(left, right)
        );
      for (const record of candidates) {
        if (surplus <= 0) break;
        let target = -1;
        for (let index = 0; index < count; index++) {
          if (index === source || counts[index] >= maximum) continue;
          if (target < 0 || counts[index] < counts[target]) target = index;
        }
        if (target < 0) {
          throw new RangeError(
            `Variant maximum for material ${material} cannot be satisfied`
          );
        }
        record.variantIndex = target;
        counts[source]--;
        counts[target]++;
        surplus--;
      }
    }
  }
  return records;
}

export function generateCorrelatedVariants({
  width,
  height,
  attemptSeed,
  terrain,
  fields,
  regions,
  capabilities,
  protectedMask,
  reservationMask,
  scanOrder = 'row-major',
  parameters = {}
}) {
  assertPositiveDimensions(width, height);
  const materialDetail = fields?.materialDetail ?? fields?.detail;
  const normalizedFields = {
    materialDetail: assertGrid(
      materialDetail,
      'fields.materialDetail',
      width,
      height,
      Number.isSafeInteger
    ),
    moisture: assertGrid(
      fields?.moisture,
      'fields.moisture',
      width,
      height,
      Number.isSafeInteger
    ),
    disturbance: assertGrid(
      fields?.disturbance,
      'fields.disturbance',
      width,
      height,
      Number.isSafeInteger
    ),
    roughness: assertGrid(
      fields?.roughness,
      'fields.roughness',
      width,
      height,
      Number.isSafeInteger
    )
  };
  assertGrid(
    terrain,
    'terrain',
    width,
    height,
    cell => cell && typeof cell.material === 'string' && cell.material.length > 0
  );
  assertGrid(
    regions?.regionIdGrid,
    'regions.regionIdGrid',
    width,
    height,
    value => value === null || (typeof value === 'string' && value.length > 0)
  );
  const excluded = combinedMask(
    width,
    height,
    optionalBooleanGrid(protectedMask, 'protectedMask', width, height),
    optionalBooleanGrid(reservationMask, 'reservationMask', width, height)
  );
  const patchSize = parameters.variantPatchSize ?? 3;
  if (!Number.isSafeInteger(patchSize) || patchSize <= 0) {
    throw new TypeError('parameters.variantPatchSize must be a positive integer');
  }
  for (const material of materialGroups(terrain).keys()) {
    variantCapability(capabilities, material);
  }
  const seed = deriveStreamSeed(attemptSeed, 'visual:variants');
  const records = [];
  for (const { x, y } of coordinateSequence(width, height, scanOrder)) {
    const material = terrain[y][x].material;
    const featureId = regions.regionIdGrid[y][x];
    const { count } = variantCapability(capabilities, material);
    const variantIndex = excluded[y][x]
      ? 0
      : chooseVariant({
          seed,
          x,
          y,
          material,
          featureId,
          count,
          fields: normalizedFields,
          patchSize
        });
    records.push({
      id: `variant:${y}:${x}`,
      x,
      y,
      material,
      variantIndex,
      featureId
    });
  }
  enforceVariantMaximum(records, capabilities, seed, excluded);
  records.sort(canonicalRecordCompare);
  return records;
}

function createTransitionRecord({
  x,
  y,
  kind,
  mask,
  capability,
  featureId
}) {
  return {
    id: `transition:${kind}:${y}:${x}`,
    x,
    y,
    kind,
    directionMask: mask,
    assetKey: capability.assetKey,
    anchor: capability.anchor,
    stratum: capability.stratum,
    precedence: capability.precedence,
    featureId
  };
}

function connectionDirection(connection) {
  const dx = connection.to.x - connection.from.x;
  const dy = connection.to.y - connection.from.y;
  return DIRECTIONS.find(direction =>
    direction.dx === dx && direction.dy === dy
  ) ?? null;
}

function compositionSet(capabilities) {
  const values = new Set();
  for (const item of capabilities.compositions) {
    if (!item || typeof item.lower !== 'string' || typeof item.upper !== 'string') {
      throw new TypeError(
        'Visual capability compositions require lower and upper strings'
      );
    }
    values.add(`${item.lower}\0${item.upper}`);
  }
  return values;
}

function hasAnyKind(kinds, predicate) {
  for (const kind of kinds) {
    if (predicate(kind)) return true;
  }
  return false;
}

function requireComposition(capabilitySet, lower, upper, x, y) {
  if (!capabilitySet.has(`${lower}\0${upper}`)) {
    throw new Error(
      `Missing visual composition capability ${lower}+${upper} at ${x},${y}`
    );
  }
}

function validateTransitionCompositions(records, capabilities) {
  const byCell = new Map();
  for (const record of records) {
    const key = `${record.x},${record.y}`;
    const kinds = byCell.get(key) ?? new Set();
    kinds.add(record.kind);
    byCell.set(key, kinds);
  }
  const declared = compositionSet(capabilities);
  for (const [key, kinds] of byCell) {
    const [x, y] = key.split(',').map(Number);
    const route = hasAnyKind(kinds, kind => kind.startsWith('route_'));
    if ((kinds.has('shore') || kinds.has('bank')) && route) {
      requireComposition(declared, 'shore', 'route', x, y);
    }
    if (route && (kinds.has('slope') || kinds.has('stairs'))) {
      requireComposition(declared, 'route', 'slope', x, y);
    }
    if (kinds.has('cliff') && kinds.has('wetness')) {
      requireComposition(declared, 'cliff', 'wetness', x, y);
    }
  }
}

export function generateSemanticTransitions({
  width,
  height,
  terrain,
  elevation,
  elevationConnections = [],
  regions,
  hydrology = {},
  routes = {},
  capabilities,
  protectedMask,
  reservationMask,
  scanOrder = 'row-major',
  parameters = {}
}) {
  assertPositiveDimensions(width, height);
  assertGrid(
    terrain,
    'terrain',
    width,
    height,
    cell => cell && typeof cell.material === 'string' && cell.material.length > 0
  );
  assertGrid(
    elevation,
    'elevation',
    width,
    height,
    value => typeof value === 'number' && Number.isFinite(value)
  );
  assertGrid(
    regions?.regionIdGrid,
    'regions.regionIdGrid',
    width,
    height,
    value => value === null || typeof value === 'string'
  );
  if (!Array.isArray(elevationConnections)) {
    throw new TypeError('elevationConnections must be an array');
  }
  const waterMask = optionalBooleanGrid(
    hydrology.featureMask ?? hydrology.waterMask,
    'hydrology.featureMask',
    width,
    height
  );
  const bankMask = optionalBooleanGrid(
    hydrology.bankMask,
    'hydrology.bankMask',
    width,
    height
  );
  const wetnessMask = optionalBooleanGrid(
    hydrology.wetnessMask,
    'hydrology.wetnessMask',
    width,
    height
  );
  const centerlineMask = optionalBooleanGrid(
    routes.masks?.centerlineMask,
    'routes.masks.centerlineMask',
    width,
    height
  );
  const pathMask = optionalBooleanGrid(
    routes.masks?.pathMask,
    'routes.masks.pathMask',
    width,
    height
  );
  const shoulderMask = optionalBooleanGrid(
    routes.masks?.shoulderMask,
    'routes.masks.shoulderMask',
    width,
    height
  );
  const excluded = combinedMask(
    width,
    height,
    optionalBooleanGrid(protectedMask, 'protectedMask', width, height),
    optionalBooleanGrid(reservationMask, 'reservationMask', width, height)
  );
  const evidence = featureMaps(width, height, regions, hydrology, routes);
  const connectedEdges = new Set();
  for (const connection of elevationConnections) {
    for (const endpoint of [connection?.from, connection?.to]) {
      if (!Number.isInteger(endpoint?.x) || !Number.isInteger(endpoint?.y) ||
          endpoint.x < 0 || endpoint.x >= width ||
          endpoint.y < 0 || endpoint.y >= height) {
        throw new TypeError(
          `Elevation connection ${String(connection?.id)} has an invalid endpoint`
        );
      }
    }
    const direction = connectionDirection(connection);
    if (!direction) {
      throw new TypeError(`Elevation connection ${String(connection?.id)} is not cardinal`);
    }
    if (connection.direction !== direction.name) {
      throw new TypeError(
        `Elevation connection ${String(connection?.id)} direction does not match endpoints`
      );
    }
    connectedEdges.add(
      `${connection.from.x},${connection.from.y}:${connection.to.x},${connection.to.y}`
    );
    connectedEdges.add(
      `${connection.to.x},${connection.to.y}:${connection.from.x},${connection.from.y}`
    );
  }
  const records = [];
  const recordById = new Map();
  const add = (x, y, kind, mask, preference = 'region', featureId = undefined) => {
    if (mask === 0 || excluded[y][x]) return;
    const capability = overlayCapability(capabilities, kind);
    const record = createTransitionRecord({
      x,
      y,
      kind,
      mask,
      capability,
      featureId: featureId === undefined
        ? sourceFeatureAt(evidence, x, y, preference)
        : featureId
    });
    const existing = recordById.get(record.id);
    if (existing) {
      existing.directionMask |= record.directionMask;
      if (existing.featureId !== record.featureId) {
        existing.featureId = [existing.featureId, record.featureId]
          .filter(value => typeof value === 'string')
          .sort()[0] ?? null;
      }
      return;
    }
    records.push(record);
    recordById.set(record.id, record);
  };
  const cliffThreshold = parameters.cliffThreshold ?? 0;
  if (typeof cliffThreshold !== 'number' || !Number.isFinite(cliffThreshold) ||
      cliffThreshold < 0) {
    throw new TypeError('parameters.cliffThreshold must be a nonnegative number');
  }
  for (const { x, y } of coordinateSequence(width, height, scanOrder)) {
    if (waterMask[y][x]) {
      add(
        x,
        y,
        'shore',
        directionMask(width, height, x, y, (nx, ny) => !waterMask[ny][nx]),
        'water'
      );
    }
    if (bankMask[y][x]) {
      add(
        x,
        y,
        'bank',
        directionMask(width, height, x, y, (nx, ny) => waterMask[ny][nx]),
        'water'
      );
    }
    if (centerlineMask[y][x]) {
      add(
        x,
        y,
        'route_center',
        directionMask(width, height, x, y, (nx, ny) => centerlineMask[ny][nx]),
        'route'
      );
    }
    if (shoulderMask[y][x]) {
      add(
        x,
        y,
        'route_shoulder',
        directionMask(width, height, x, y, (nx, ny) => pathMask[ny][nx]),
        'route'
      );
    }
    if (pathMask[y][x]) {
      add(
        x,
        y,
        'route_edge',
        directionMask(width, height, x, y, (nx, ny) => !pathMask[ny][nx]),
        'route'
      );
    }
    add(
      x,
      y,
      'material_edge',
      directionMask(
        width,
        height,
        x,
        y,
        (nx, ny) => terrain[ny][nx].material !== terrain[y][x].material
      )
    );
    add(
      x,
      y,
      'cliff',
      directionMask(width, height, x, y, (nx, ny) =>
        elevation[y][x] - elevation[ny][nx] > cliffThreshold &&
        !connectedEdges.has(`${x},${y}:${nx},${ny}`)
      )
    );
    if (wetnessMask[y][x]) {
      add(
        x,
        y,
        'wetness',
        directionMask(width, height, x, y, (nx, ny) => !wetnessMask[ny][nx]),
        'water'
      );
    }
  }
  for (const connection of [...elevationConnections].sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  )) {
    const kind = CONNECTION_KINDS.get(connection.kind);
    if (!kind) continue;
    const direction = connectionDirection(connection);
    add(
      connection.from.x,
      connection.from.y,
      kind,
      direction.bit,
      'region',
      connection.featureId ?? sourceFeatureAt(
        evidence,
        connection.from.x,
        connection.from.y
      )
    );
  }
  records.sort(canonicalRecordCompare);
  validateTransitionCompositions(records, capabilities);
  return records;
}

function decorationSuitability(mode, evidence) {
  switch (mode) {
    case 'moist':
      return evidence.moisture - Math.max(0, evidence.disturbance) / 2;
    case 'overgrowth':
      return evidence.moisture - evidence.disturbance;
    case 'rough':
      return evidence.roughness + Math.abs(evidence.height) / 2;
    case 'dry':
      return -evidence.moisture - Math.max(0, evidence.disturbance) / 3;
    case 'waterside':
      return evidence.bank ? 2 * SCALE : evidence.wet ? SCALE : -SCALE;
    case 'disturbed':
      return evidence.disturbance + evidence.roughness / 3;
    case 'ash':
      return evidence.lava ? 2 * SCALE : evidence.disturbance;
    default:
      throw new TypeError(`Unsupported decoration evidence mode: ${String(mode)}`);
  }
}

function propMask(width, height, ecology) {
  const result = optionalBooleanGrid(
    ecology.blockingMask,
    'ecology.blockingMask',
    width,
    height
  ).map(row => [...row]);
  for (const obstacle of ecology.obstacles ?? []) {
    if (!Number.isInteger(obstacle.x) || !Number.isInteger(obstacle.y) ||
        obstacle.x < 0 || obstacle.x >= width ||
        obstacle.y < 0 || obstacle.y >= height) {
      throw new TypeError('ecology.obstacles contains an invalid coordinate');
    }
    result[obstacle.y][obstacle.x] = true;
  }
  return result;
}

function hintedDecorationMap(ecology) {
  const result = new Map();
  for (const decoration of ecology.decorations ?? []) {
    const key = `${decoration.x},${decoration.y}`;
    const kinds = result.get(key) ?? new Set();
    kinds.add(decoration.kind);
    result.set(key, kinds);
  }
  return result;
}

function validateDecorationPropCompositions(decorations, props, capabilities) {
  const declared = compositionSet(capabilities);
  for (const decoration of decorations) {
    if (!props[decoration.y][decoration.x]) continue;
    requireComposition(
      declared,
      'decoration',
      'prop',
      decoration.x,
      decoration.y
    );
  }
}

export function generateNonblockingDecorations({
  width,
  height,
  attemptSeed,
  recipe,
  terrain,
  fields,
  regions,
  hydrology = {},
  routes = {},
  ecology = {},
  capabilities,
  protectedMask,
  reservationMask,
  scanOrder = 'row-major',
  parameters = {}
}) {
  assertPositiveDimensions(width, height);
  assertGrid(
    terrain,
    'terrain',
    width,
    height,
    cell => cell && typeof cell.passable === 'boolean'
  );
  const materialDetail = fields?.materialDetail ?? fields?.detail;
  for (const [name, grid] of Object.entries({
    materialDetail,
    moisture: fields?.moisture,
    disturbance: fields?.disturbance,
    roughness: fields?.roughness,
    height: fields?.height
  })) {
    assertGrid(grid, `fields.${name}`, width, height, Number.isSafeInteger);
  }
  assertGrid(
    regions?.regionIdGrid,
    'regions.regionIdGrid',
    width,
    height,
    value => value === null || typeof value === 'string'
  );
  const families = parameters.decorationFamilies ?? recipe.decorationFamilies;
  if (!Array.isArray(families) || families.length === 0) {
    throw new TypeError('Decorations require at least one recipe decoration family');
  }
  const uniqueFamilies = [...new Set(families)].sort();
  for (const family of uniqueFamilies) {
    if (!Object.hasOwn(DECORATION_MODES, family)) {
      throw new TypeError(`Unsupported decoration family: ${family}`);
    }
    decorationCapability(capabilities, family);
  }
  const density = parameters.decorationDensity ?? recipe.ecology?.decorationDensity;
  if (!Number.isSafeInteger(density) || density < 0 || density > SCALE) {
    throw new TypeError('decorationDensity must be a fixed-point integer in [0, 1000000]');
  }
  const clusterSize = parameters.decorationClusterSize ?? 4;
  if (!Number.isSafeInteger(clusterSize) || clusterSize <= 0) {
    throw new TypeError('decorationClusterSize must be a positive integer');
  }
  const waterMask = optionalBooleanGrid(
    hydrology.featureMask ?? hydrology.waterMask,
    'hydrology.featureMask',
    width,
    height
  );
  const bankMask = optionalBooleanGrid(
    hydrology.bankMask,
    'hydrology.bankMask',
    width,
    height
  );
  const wetnessMask = optionalBooleanGrid(
    hydrology.wetnessMask,
    'hydrology.wetnessMask',
    width,
    height
  );
  const routeMask = optionalBooleanGrid(
    routes.masks?.pathMask,
    'routes.masks.pathMask',
    width,
    height
  );
  const excluded = combinedMask(
    width,
    height,
    optionalBooleanGrid(protectedMask, 'protectedMask', width, height),
    optionalBooleanGrid(reservationMask, 'reservationMask', width, height)
  );
  const props = propMask(width, height, ecology);
  const hints = hintedDecorationMap(ecology);
  const evidence = featureMaps(width, height, regions, hydrology, routes);
  const seed = deriveStreamSeed(attemptSeed, 'visual:decorations');
  const candidates = [];
  for (const { x, y } of coordinateSequence(width, height, scanOrder)) {
    if (excluded[y][x] || !terrain[y][x].passable) continue;
    for (const family of uniqueFamilies) {
      const cellEvidence = {
        moisture: fields.moisture[y][x],
        disturbance: fields.disturbance[y][x],
        roughness: fields.roughness[y][x],
        height: fields.height[y][x],
        water: waterMask[y][x],
        bank: bankMask[y][x],
        wet: wetnessMask[y][x],
        lava: hydrology.lavaMask?.[y]?.[x] === true
      };
      let suitability = decorationSuitability(
        DECORATION_MODES[family],
        cellEvidence
      );
      if (hints.get(`${x},${y}`)?.has(family)) suitability += SCALE;
      if (routeMask[y][x] && family !== 'debris' && family !== 'rubble') {
        suitability -= SCALE;
      }
      const clusterX = Math.floor(x / clusterSize);
      const clusterY = Math.floor(y / clusterSize);
      const cluster = coordinateHash32(
        seed,
        clusterX,
        clusterY,
        `cluster:${family}`
      ) % (2 * SCALE + 1);
      const jitter = coordinateHash32(seed, x, y, `jitter:${family}`) %
        Math.max(1, Math.floor(SCALE / 5));
      candidates.push({
        x,
        y,
        family,
        score: suitability + cluster + jitter,
        featureId: sourceFeatureAt(
          evidence,
          x,
          y,
          family === 'reeds' ? 'water' : 'region'
        )
      });
    }
  }
  candidates.sort((left, right) =>
    right.score - left.score ||
    coordinateHash32(seed, left.x, left.y, `rank:${left.family}`) -
      coordinateHash32(seed, right.x, right.y, `rank:${right.family}`) ||
    left.y - right.y ||
    left.x - right.x ||
    left.family.localeCompare(right.family)
  );
  const limit = Math.min(
    width * height,
    Math.floor(width * height * density / SCALE)
  );
  const occupied = new Set();
  const records = [];
  for (const candidate of candidates) {
    if (records.length >= limit) break;
    const key = `${candidate.x},${candidate.y}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    const capability = decorationCapability(capabilities, candidate.family);
    records.push({
      id: `decoration:${candidate.family}:${candidate.y}:${candidate.x}`,
      x: candidate.x,
      y: candidate.y,
      kind: candidate.family,
      assetKey: capability.assetKey,
      variantIndex: coordinateHash32(
        seed,
        candidate.x,
        candidate.y,
        `variant:${candidate.family}`
      ) % capability.variantCount,
      anchor: capability.anchor,
      featureId: candidate.featureId
    });
  }
  records.sort(canonicalRecordCompare);
  validateDecorationPropCompositions(records, props, capabilities);
  return records;
}

function validateInputs(options) {
  const {
    width,
    height,
    attemptSeed,
    recipe,
    terrain,
    elevation,
    fields,
    regions,
    capabilities
  } = options;
  assertPositiveDimensions(width, height);
  if (!Number.isSafeInteger(attemptSeed) || attemptSeed < 0) {
    throw new TypeError('Visual layers attemptSeed must be a nonnegative safe integer');
  }
  if (!recipe || typeof recipe.renderPalette !== 'string') {
    throw new TypeError('Visual layers require a resolved recipe');
  }
  assertCapabilities(capabilities, recipe);
  assertGrid(terrain, 'terrain', width, height, cell =>
    cell && typeof cell.material === 'string' && typeof cell.passable === 'boolean'
  );
  assertGrid(elevation, 'elevation', width, height, value =>
    typeof value === 'number' && Number.isFinite(value)
  );
  if (!fields || !regions) {
    throw new TypeError('Visual layers require landscape fields and region evidence');
  }
}

/**
 * Populate all three frozen visual record collections from the final semantic
 * layers. Capability data is supplied by the caller; this stage never invents
 * an asset key or silently falls back to a recipe default.
 */
export function generateVisualLayers(options) {
  validateInputs(options);
  const {
    width,
    height,
    attemptSeed,
    recipe,
    terrain,
    elevation,
    fields,
    regions,
    hydrology = {},
    routes = {},
    ecology = {},
    elevationConnections = [],
    capabilities,
    scanOrder = 'row-major',
    parameters = {}
  } = options;
  const coreMask = optionalBooleanGrid(
    options.protectedMask ?? options.spawnLayout?.coreMask,
    'protectedMask',
    width,
    height
  );
  const featherMask = optionalBooleanGrid(
    options.spawnLayout?.featherMask,
    'spawnLayout.featherMask',
    width,
    height
  );
  const protectedMask = combinedMask(width, height, coreMask, featherMask);
  const reservationMask = optionalBooleanGrid(
    options.reservationMask,
    'reservationMask',
    width,
    height
  );
  const shared = {
    width,
    height,
    attemptSeed,
    recipe,
    terrain,
    fields,
    regions,
    hydrology,
    routes,
    ecology,
    capabilities,
    protectedMask,
    reservationMask,
    scanOrder,
    parameters
  };
  const variants = generateCorrelatedVariants(shared);
  const transitions = generateSemanticTransitions({
    ...shared,
    elevation,
    elevationConnections
  });
  const decorations = generateNonblockingDecorations(shared);
  return deepFreeze({
    visualLayersVersion: VISUAL_LAYERS_VERSION,
    variants,
    transitions,
    decorations,
    diagnostics: {
      variantCount: variants.length,
      transitionCount: transitions.length,
      decorationCount: decorations.length,
      protectedTileCount: protectedMask.reduce(
        (total, row) => total + row.filter(Boolean).length,
        0
      ),
      reservedTileCount: reservationMask.reduce(
        (total, row) => total + row.filter(Boolean).length,
        0
      )
    }
  });
}
