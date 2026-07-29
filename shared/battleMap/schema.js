/**
 * Closed BattleMapV2 value contract.
 *
 * Coordinates are zero-based tile coordinates. Grid coordinates are implicit:
 * `grid[y][x]`. Every object below is closed; validators reject unknown keys.
 * Catalog keys (materials, assets, recipes, and kinds) are non-empty strings
 * whose availability is checked by the separately versioned asset catalog.
 *
 * Stable identity rules:
 * - every feature `id` is unique across every feature collection;
 * - every record `id` is unique within its owning collection;
 * - `featureId`, `parentFeatureId`, and `anchorFeatureIds` reference a feature;
 * - `regionId` and `parentRegionId` reference `features.regions`;
 * - region adjacency is an in-map region reference and cannot reference self.
 */

export const BATTLE_MAP_SCHEMA_VERSION = 2;
export const TERRAIN_GENERATION_VERSION = 2;
export const BATTLE_MAP_HASH_VERSION = 'sha256-cjson-v1';
export const ELEVATION_FORMAT = 'normalized';

export const ELEVATION_CONNECTION_KINDS = Object.freeze([
  'ramp', 'stairs', 'ledge', 'cliff', 'slope', 'long_ramp', 'multi_stairs'
]);
export const CARDINAL_DIRECTIONS = Object.freeze(['n', 'e', 's', 'w']);
export const TRANSITION_KINDS = Object.freeze([
  'shore', 'bank', 'route_center', 'route_shoulder', 'route_edge',
  'material_edge', 'cliff', 'exposed_face', 'slope', 'stairs',
  'wetness', 'talus', 'snow', 'ash', 'overgrowth'
]);
export const TRANSITION_ANCHORS = Object.freeze([
  'below_prop', 'tile_top', 'exposed_face', 'above_connection'
]);
export const SPAWN_SIDES = Object.freeze(['player', 'enemy', 'arena_north', 'arena_south']);
export const SPAWN_ZONE_KINDS = Object.freeze(['core', 'feather', 'staging']);
export const ALGORITHM_STATUSES = Object.freeze(['applied', 'omitted']);
export const RECIPE_ROUNDING_RULES = Object.freeze([
  'half-away-from-zero', 'half-to-even', 'floor', 'ceil', 'truncate'
]);

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function push(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function object(value, path, keys, errors) {
  if (!isPlainObject(value)) {
    push(errors, path, 'must be a plain object');
    return false;
  }
  const actual = Object.keys(value);
  for (const key of keys) {
    if (!own(value, key)) push(errors, `${path}.${key}`, 'is required');
  }
  for (const key of actual) {
    if (!keys.includes(key)) push(errors, `${path}.${key}`, 'additional property is not allowed');
  }
  return true;
}

function array(value, path, errors) {
  if (!Array.isArray(value)) {
    push(errors, path, 'must be an array');
    return false;
  }
  return true;
}

function string(value, path, errors, { nullable = false, pattern } = {}) {
  if (nullable && value === null) return true;
  if (typeof value !== 'string' || value.length === 0) {
    push(errors, path, 'must be a non-empty string');
    return false;
  }
  if (pattern && !pattern.test(value)) {
    push(errors, path, `must match ${pattern}`);
    return false;
  }
  return true;
}

function integer(value, path, errors, { min, max } = {}) {
  if (!Number.isSafeInteger(value)) {
    push(errors, path, 'must be a safe integer');
    return false;
  }
  if (min !== undefined && value < min) push(errors, path, `must be >= ${min}`);
  if (max !== undefined && value > max) push(errors, path, `must be <= ${max}`);
  return true;
}

function finite(value, path, errors, { min, max, nullable = false } = {}) {
  if (nullable && value === null) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    push(errors, path, 'must be a finite number');
    return false;
  }
  if (min !== undefined && value < min) push(errors, path, `must be >= ${min}`);
  if (max !== undefined && value > max) push(errors, path, `must be <= ${max}`);
  return true;
}

function boolean(value, path, errors) {
  if (typeof value !== 'boolean') {
    push(errors, path, 'must be a boolean');
    return false;
  }
  return true;
}

function enumeration(value, path, values, errors) {
  if (!values.includes(value)) {
    push(errors, path, `must be one of ${values.join(', ')}`);
    return false;
  }
  return true;
}

function uniqueStrings(values, path, errors) {
  if (!array(values, path, errors)) return;
  const seen = new Set();
  values.forEach((value, index) => {
    if (!string(value, `${path}[${index}]`, errors)) return;
    if (seen.has(value)) push(errors, `${path}[${index}]`, `duplicate value ${value}`);
    seen.add(value);
  });
}

function coord(value, path, errors, dimensions) {
  if (!object(value, path, ['x', 'y'], errors)) return;
  integer(value.x, `${path}.x`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.y, `${path}.y`, errors, { min: 0, max: dimensions.height - 1 });
}

function bounds(value, path, errors, dimensions) {
  if (!object(value, path, ['minX', 'minY', 'maxX', 'maxY'], errors)) return;
  integer(value.minX, `${path}.minX`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.minY, `${path}.minY`, errors, { min: 0, max: dimensions.height - 1 });
  integer(value.maxX, `${path}.maxX`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.maxY, `${path}.maxY`, errors, { min: 0, max: dimensions.height - 1 });
  if (Number.isInteger(value.minX) && Number.isInteger(value.maxX) && value.minX > value.maxX) {
    push(errors, path, 'minX must be <= maxX');
  }
  if (Number.isInteger(value.minY) && Number.isInteger(value.maxY) && value.minY > value.maxY) {
    push(errors, path, 'minY must be <= maxY');
  }
}

function idArray(records, path, errors, globalIds = null) {
  const ids = new Set();
  records.forEach((record, index) => {
    if (!isPlainObject(record) || typeof record.id !== 'string') return;
    if (ids.has(record.id)) push(errors, `${path}[${index}].id`, `duplicate id ${record.id}`);
    ids.add(record.id);
    if (globalIds) {
      if (globalIds.has(record.id)) push(errors, `${path}[${index}].id`, `duplicate global feature id ${record.id}`);
      globalIds.add(record.id);
    }
  });
  return ids;
}

function grid(value, path, errors, dimensions, cellValidator) {
  if (!array(value, path, errors)) return;
  if (value.length !== dimensions.height) push(errors, path, `must contain ${dimensions.height} rows`);
  value.forEach((row, y) => {
    if (!array(row, `${path}[${y}]`, errors)) return;
    if (row.length !== dimensions.width) push(errors, `${path}[${y}]`, `must contain ${dimensions.width} cells`);
    row.forEach((cell, x) => cellValidator(cell, `${path}[${y}][${x}]`, errors));
  });
}

function terrainCell(value, path, errors) {
  if (!object(value, path, ['material', 'movementCost', 'passable', 'regionId'], errors)) return;
  string(value.material, `${path}.material`, errors);
  finite(value.movementCost, `${path}.movementCost`, errors, { min: 0 });
  boolean(value.passable, `${path}.passable`, errors);
  string(value.regionId, `${path}.regionId`, errors, { nullable: true });
}

function validateFeatureCollections(features, path, errors, dimensions) {
  const keys = ['regions', 'waterBodies', 'routes', 'clearings', 'structures'];
  if (!object(features, path, keys, errors)) return null;
  for (const key of keys) array(features[key], `${path}.${key}`, errors);
  if (errors.length) return null;

  features.regions.forEach((record, index) => {
    const p = `${path}.regions[${index}]`;
    if (!object(record, p, ['id', 'kind', 'material', 'bounds', 'area', 'adjacentRegionIds', 'parentFeatureId'], errors)) return;
    string(record.id, `${p}.id`, errors);
    string(record.kind, `${p}.kind`, errors);
    string(record.material, `${p}.material`, errors);
    bounds(record.bounds, `${p}.bounds`, errors, dimensions);
    integer(record.area, `${p}.area`, errors, { min: 1, max: dimensions.width * dimensions.height });
    uniqueStrings(record.adjacentRegionIds, `${p}.adjacentRegionIds`, errors);
    string(record.parentFeatureId, `${p}.parentFeatureId`, errors, { nullable: true });
  });
  features.waterBodies.forEach((record, index) => {
    const p = `${path}.waterBodies[${index}]`;
    if (!object(record, p, ['id', 'kind', 'material', 'bounds', 'cells', 'sourceCells', 'outletCell', 'parentRegionId'], errors)) return;
    string(record.id, `${p}.id`, errors);
    string(record.kind, `${p}.kind`, errors);
    string(record.material, `${p}.material`, errors);
    bounds(record.bounds, `${p}.bounds`, errors, dimensions);
    if (array(record.cells, `${p}.cells`, errors)) record.cells.forEach((item, i) => coord(item, `${p}.cells[${i}]`, errors, dimensions));
    if (array(record.sourceCells, `${p}.sourceCells`, errors)) record.sourceCells.forEach((item, i) => coord(item, `${p}.sourceCells[${i}]`, errors, dimensions));
    if (record.outletCell !== null) coord(record.outletCell, `${p}.outletCell`, errors, dimensions);
    string(record.parentRegionId, `${p}.parentRegionId`, errors, { nullable: true });
  });
  features.routes.forEach((record, index) => {
    const p = `${path}.routes[${index}]`;
    if (!object(record, p, ['id', 'kind', 'material', 'centerline', 'width', 'required', 'anchorFeatureIds'], errors)) return;
    string(record.id, `${p}.id`, errors);
    string(record.kind, `${p}.kind`, errors);
    string(record.material, `${p}.material`, errors);
    if (array(record.centerline, `${p}.centerline`, errors)) record.centerline.forEach((item, i) => coord(item, `${p}.centerline[${i}]`, errors, dimensions));
    finite(record.width, `${p}.width`, errors, { min: 0 });
    boolean(record.required, `${p}.required`, errors);
    uniqueStrings(record.anchorFeatureIds, `${p}.anchorFeatureIds`, errors);
  });
  features.clearings.forEach((record, index) => {
    const p = `${path}.clearings[${index}]`;
    if (!object(record, p, ['id', 'kind', 'bounds', 'cells', 'parentRegionId'], errors)) return;
    string(record.id, `${p}.id`, errors);
    string(record.kind, `${p}.kind`, errors);
    bounds(record.bounds, `${p}.bounds`, errors, dimensions);
    if (array(record.cells, `${p}.cells`, errors)) record.cells.forEach((item, i) => coord(item, `${p}.cells[${i}]`, errors, dimensions));
    string(record.parentRegionId, `${p}.parentRegionId`, errors, { nullable: true });
  });
  features.structures.forEach((record, index) => {
    const p = `${path}.structures[${index}]`;
    if (!object(record, p, ['id', 'kind', 'assetKey', 'footprint', 'entrances', 'parentRegionId'], errors)) return;
    string(record.id, `${p}.id`, errors);
    string(record.kind, `${p}.kind`, errors);
    string(record.assetKey, `${p}.assetKey`, errors);
    if (array(record.footprint, `${p}.footprint`, errors)) record.footprint.forEach((item, i) => coord(item, `${p}.footprint[${i}]`, errors, dimensions));
    if (array(record.entrances, `${p}.entrances`, errors)) record.entrances.forEach((item, i) => coord(item, `${p}.entrances[${i}]`, errors, dimensions));
    string(record.parentRegionId, `${p}.parentRegionId`, errors, { nullable: true });
  });

  const featureIds = new Set();
  const ids = {};
  for (const key of keys) ids[key] = idArray(features[key], `${path}.${key}`, errors, featureIds);
  return { featureIds, regionIds: ids.regions };
}

function validateResolvedRecipe(value, path, errors) {
  if (!object(value, path, ['recipeId', 'recipeVersion', 'renderPalette', 'quantization', 'parameters'], errors)) return;
  string(value.recipeId, `${path}.recipeId`, errors);
  string(value.recipeVersion, `${path}.recipeVersion`, errors);
  string(value.renderPalette, `${path}.renderPalette`, errors);
  if (object(value.quantization, `${path}.quantization`, ['scale', 'rounding'], errors)) {
    integer(value.quantization.scale, `${path}.quantization.scale`, errors, { min: 1 });
    enumeration(value.quantization.rounding, `${path}.quantization.rounding`, RECIPE_ROUNDING_RULES, errors);
  }
  if (array(value.parameters, `${path}.parameters`, errors)) {
    const names = new Set();
    value.parameters.forEach((parameter, index) => {
      const p = `${path}.parameters[${index}]`;
      if (!object(parameter, p, ['name', 'value'], errors)) return;
      string(parameter.name, `${p}.name`, errors);
      const type = typeof parameter.value;
      if (!['string', 'number', 'boolean'].includes(type) || (type === 'number' && !Number.isFinite(parameter.value))) {
        push(errors, `${p}.value`, 'must be a finite number, string, or boolean');
      }
      if (names.has(parameter.name)) push(errors, `${p}.name`, `duplicate parameter ${parameter.name}`);
      names.add(parameter.name);
    });
  }
}

function validationResult(value, path, errors, validityKey) {
  if (!object(value, path, [validityKey, 'checks'], errors)) return;
  boolean(value[validityKey], `${path}.${validityKey}`, errors);
  if (array(value.checks, `${path}.checks`, errors)) {
    idArray(value.checks, `${path}.checks`, errors);
    value.checks.forEach((check, index) => {
      const p = `${path}.checks[${index}]`;
      if (!object(check, p, ['id', 'passed', 'message', 'featureIds'], errors)) return;
      string(check.id, `${p}.id`, errors);
      boolean(check.passed, `${p}.passed`, errors);
      string(check.message, `${p}.message`, errors);
      uniqueStrings(check.featureIds, `${p}.featureIds`, errors);
    });
  }
}

function validateDiagnostics(value, path, errors, final) {
  const keys = [
    'resolvedRecipe', 'attempt', 'streamVersion', 'hashVersion', 'algorithms',
    'hardValidation', 'tacticalValidation', 'qualityMetrics'
  ];
  if (final) keys.push('hashes');
  if (!object(value, path, keys, errors)) return;
  validateResolvedRecipe(value.resolvedRecipe, `${path}.resolvedRecipe`, errors);
  integer(value.attempt, `${path}.attempt`, errors, { min: 0 });
  string(value.streamVersion, `${path}.streamVersion`, errors);
  if (value.hashVersion !== BATTLE_MAP_HASH_VERSION) push(errors, `${path}.hashVersion`, `must equal ${BATTLE_MAP_HASH_VERSION}`);
  if (array(value.algorithms, `${path}.algorithms`, errors)) {
    idArray(value.algorithms, `${path}.algorithms`, errors);
    value.algorithms.forEach((algorithm, index) => {
      const p = `${path}.algorithms[${index}]`;
      if (!object(algorithm, p, ['id', 'stage', 'version', 'optional', 'status', 'outputFeatureIds'], errors)) return;
      string(algorithm.id, `${p}.id`, errors);
      string(algorithm.stage, `${p}.stage`, errors);
      string(algorithm.version, `${p}.version`, errors);
      boolean(algorithm.optional, `${p}.optional`, errors);
      enumeration(algorithm.status, `${p}.status`, ALGORITHM_STATUSES, errors);
      if (algorithm.status === 'omitted' && algorithm.optional !== true) {
        push(errors, `${p}.status`, 'required algorithms cannot be omitted');
      }
      uniqueStrings(algorithm.outputFeatureIds, `${p}.outputFeatureIds`, errors);
    });
  }
  validationResult(value.hardValidation, `${path}.hardValidation`, errors, 'valid');
  validationResult(value.tacticalValidation, `${path}.tacticalValidation`, errors, 'passed');
  if (object(value.qualityMetrics, `${path}.qualityMetrics`, ['score', 'metrics'], errors)) {
    finite(value.qualityMetrics.score, `${path}.qualityMetrics.score`, errors);
    if (array(value.qualityMetrics.metrics, `${path}.qualityMetrics.metrics`, errors)) {
      idArray(value.qualityMetrics.metrics, `${path}.qualityMetrics.metrics`, errors);
      value.qualityMetrics.metrics.forEach((metric, index) => {
        const p = `${path}.qualityMetrics.metrics[${index}]`;
        if (!object(metric, p, ['id', 'value', 'target', 'passed'], errors)) return;
        string(metric.id, `${p}.id`, errors);
        finite(metric.value, `${p}.value`, errors);
        finite(metric.target, `${p}.target`, errors, { nullable: true });
        boolean(metric.passed, `${p}.passed`, errors);
      });
    }
  }
  if (final && object(value.hashes, `${path}.hashes`, ['authoritativeHash', 'visualHash', 'fullHash'], errors)) {
    string(value.hashes.authoritativeHash, `${path}.hashes.authoritativeHash`, errors, { pattern: HASH_PATTERN });
    string(value.hashes.visualHash, `${path}.hashes.visualHash`, errors, { pattern: HASH_PATTERN });
    string(value.hashes.fullHash, `${path}.hashes.fullHash`, errors, { pattern: HASH_PATTERN });
  }
}

const MAP_KEYS = Object.freeze([
  'battleMapSchemaVersion', 'terrainGenerationVersion', 'terrainSeed',
  'mapWidth', 'mapHeight', 'nodeType', 'biome', 'archetype', 'elevationFormat',
  'terrain', 'elevation', 'elevationConnections', 'obstacles', 'spawnLayout',
  'variants', 'transitions', 'decorations', 'features', 'diagnostics'
]);

function validateMap(value, final) {
  const errors = [];
  const root = final ? 'BattleMapV2Final' : 'BattleMapV2Candidate';
  if (!object(value, root, MAP_KEYS, errors)) return { valid: false, errors };
  if (value.battleMapSchemaVersion !== BATTLE_MAP_SCHEMA_VERSION) push(errors, `${root}.battleMapSchemaVersion`, 'must equal 2');
  if (value.terrainGenerationVersion !== TERRAIN_GENERATION_VERSION) push(errors, `${root}.terrainGenerationVersion`, 'must equal 2');
  integer(value.terrainSeed, `${root}.terrainSeed`, errors);
  integer(value.mapWidth, `${root}.mapWidth`, errors, { min: 1 });
  integer(value.mapHeight, `${root}.mapHeight`, errors, { min: 1 });
  string(value.nodeType, `${root}.nodeType`, errors);
  string(value.biome, `${root}.biome`, errors);
  string(value.archetype, `${root}.archetype`, errors);
  if (value.elevationFormat !== ELEVATION_FORMAT) push(errors, `${root}.elevationFormat`, `must equal ${ELEVATION_FORMAT}`);
  const dimensions = {
    width: Number.isSafeInteger(value.mapWidth) && value.mapWidth > 0 ? value.mapWidth : 1,
    height: Number.isSafeInteger(value.mapHeight) && value.mapHeight > 0 ? value.mapHeight : 1
  };
  grid(value.terrain, `${root}.terrain`, errors, dimensions, terrainCell);
  grid(value.elevation, `${root}.elevation`, errors, dimensions, (cell, path, target) => {
    finite(cell, path, target, { min: 0, max: 1 });
  });

  if (array(value.elevationConnections, `${root}.elevationConnections`, errors)) {
    idArray(value.elevationConnections, `${root}.elevationConnections`, errors);
    value.elevationConnections.forEach((record, index) => {
      const p = `${root}.elevationConnections[${index}]`;
      if (!object(record, p, ['id', 'from', 'to', 'kind', 'direction', 'elevationDelta', 'bidirectional', 'featureId'], errors)) return;
      string(record.id, `${p}.id`, errors);
      coord(record.from, `${p}.from`, errors, dimensions);
      coord(record.to, `${p}.to`, errors, dimensions);
      enumeration(record.kind, `${p}.kind`, ELEVATION_CONNECTION_KINDS, errors);
      enumeration(record.direction, `${p}.direction`, CARDINAL_DIRECTIONS, errors);
      finite(record.elevationDelta, `${p}.elevationDelta`, errors, { min: -1, max: 1 });
      boolean(record.bidirectional, `${p}.bidirectional`, errors);
      string(record.featureId, `${p}.featureId`, errors, { nullable: true });
    });
  }
  if (array(value.obstacles, `${root}.obstacles`, errors)) {
    idArray(value.obstacles, `${root}.obstacles`, errors);
    value.obstacles.forEach((record, index) => {
      const p = `${root}.obstacles[${index}]`;
      if (!object(record, p, ['id', 'x', 'y', 'kind', 'assetKey', 'blocking', 'movementCost', 'featureId'], errors)) return;
      string(record.id, `${p}.id`, errors);
      integer(record.x, `${p}.x`, errors, { min: 0, max: dimensions.width - 1 });
      integer(record.y, `${p}.y`, errors, { min: 0, max: dimensions.height - 1 });
      string(record.kind, `${p}.kind`, errors);
      string(record.assetKey, `${p}.assetKey`, errors);
      boolean(record.blocking, `${p}.blocking`, errors);
      finite(record.movementCost, `${p}.movementCost`, errors, { min: 0 });
      string(record.featureId, `${p}.featureId`, errors, { nullable: true });
    });
  }
  if (object(value.spawnLayout, `${root}.spawnLayout`, ['slots', 'protectedZones', 'stagingRegions', 'exits', 'minimumApproachExits'], errors)) {
    if (array(value.spawnLayout.slots, `${root}.spawnLayout.slots`, errors)) {
      idArray(value.spawnLayout.slots, `${root}.spawnLayout.slots`, errors);
      value.spawnLayout.slots.forEach((record, index) => {
        const p = `${root}.spawnLayout.slots[${index}]`;
        if (!object(record, p, ['id', 'side', 'role', 'x', 'y', 'selected'], errors)) return;
        string(record.id, `${p}.id`, errors);
        enumeration(record.side, `${p}.side`, SPAWN_SIDES, errors);
        string(record.role, `${p}.role`, errors);
        integer(record.x, `${p}.x`, errors, { min: 0, max: dimensions.width - 1 });
        integer(record.y, `${p}.y`, errors, { min: 0, max: dimensions.height - 1 });
        boolean(record.selected, `${p}.selected`, errors);
      });
    }
    if (array(value.spawnLayout.protectedZones, `${root}.spawnLayout.protectedZones`, errors)) {
      idArray(value.spawnLayout.protectedZones, `${root}.spawnLayout.protectedZones`, errors);
      value.spawnLayout.protectedZones.forEach((record, index) => {
        const p = `${root}.spawnLayout.protectedZones[${index}]`;
        if (!object(record, p, ['id', 'kind', 'side', 'bounds', 'minimumClearance'], errors)) return;
        string(record.id, `${p}.id`, errors);
        enumeration(record.kind, `${p}.kind`, SPAWN_ZONE_KINDS, errors);
        enumeration(record.side, `${p}.side`, SPAWN_SIDES, errors);
        bounds(record.bounds, `${p}.bounds`, errors, dimensions);
        finite(record.minimumClearance, `${p}.minimumClearance`, errors, { min: 0 });
      });
    }
    if (array(value.spawnLayout.stagingRegions, `${root}.spawnLayout.stagingRegions`, errors)) {
      idArray(value.spawnLayout.stagingRegions, `${root}.spawnLayout.stagingRegions`, errors);
      value.spawnLayout.stagingRegions.forEach((record, index) => {
        const p = `${root}.spawnLayout.stagingRegions[${index}]`;
        if (!object(record, p, ['id', 'side', 'strategy', 'bounds', 'capacity'], errors)) return;
        string(record.id, `${p}.id`, errors);
        enumeration(record.side, `${p}.side`, SPAWN_SIDES, errors);
        string(record.strategy, `${p}.strategy`, errors);
        bounds(record.bounds, `${p}.bounds`, errors, dimensions);
        integer(record.capacity, `${p}.capacity`, errors, { min: 0 });
      });
    }
    if (array(value.spawnLayout.exits, `${root}.spawnLayout.exits`, errors)) {
      value.spawnLayout.exits.forEach((record, index) => {
        const p = `${root}.spawnLayout.exits[${index}]`;
        if (!object(record, p, ['id', 'zoneId', 'x', 'y'], errors)) return;
        string(record.id, `${p}.id`, errors);
        string(record.zoneId, `${p}.zoneId`, errors);
        integer(record.x, `${p}.x`, errors, { min: 0, max: dimensions.width - 1 });
        integer(record.y, `${p}.y`, errors, { min: 0, max: dimensions.height - 1 });
      });
      idArray(value.spawnLayout.exits, `${root}.spawnLayout.exits`, errors);
    }
    integer(value.spawnLayout.minimumApproachExits, `${root}.spawnLayout.minimumApproachExits`, errors, { min: 0 });
  }
  if (array(value.variants, `${root}.variants`, errors)) {
    idArray(value.variants, `${root}.variants`, errors);
    value.variants.forEach((record, index) => {
      const p = `${root}.variants[${index}]`;
      if (!object(record, p, ['id', 'x', 'y', 'material', 'variantIndex', 'featureId'], errors)) return;
      string(record.id, `${p}.id`, errors);
      integer(record.x, `${p}.x`, errors, { min: 0, max: dimensions.width - 1 });
      integer(record.y, `${p}.y`, errors, { min: 0, max: dimensions.height - 1 });
      string(record.material, `${p}.material`, errors);
      integer(record.variantIndex, `${p}.variantIndex`, errors, { min: 0 });
      string(record.featureId, `${p}.featureId`, errors, { nullable: true });
    });
  }
  if (array(value.transitions, `${root}.transitions`, errors)) {
    idArray(value.transitions, `${root}.transitions`, errors);
    value.transitions.forEach((record, index) => {
      const p = `${root}.transitions[${index}]`;
      if (!object(record, p, ['id', 'x', 'y', 'kind', 'directionMask', 'assetKey', 'anchor', 'stratum', 'precedence', 'featureId'], errors)) return;
      string(record.id, `${p}.id`, errors);
      integer(record.x, `${p}.x`, errors, { min: 0, max: dimensions.width - 1 });
      integer(record.y, `${p}.y`, errors, { min: 0, max: dimensions.height - 1 });
      enumeration(record.kind, `${p}.kind`, TRANSITION_KINDS, errors);
      integer(record.directionMask, `${p}.directionMask`, errors, { min: 0, max: 15 });
      string(record.assetKey, `${p}.assetKey`, errors);
      enumeration(record.anchor, `${p}.anchor`, TRANSITION_ANCHORS, errors);
      integer(record.stratum, `${p}.stratum`, errors);
      integer(record.precedence, `${p}.precedence`, errors);
      string(record.featureId, `${p}.featureId`, errors, { nullable: true });
    });
  }
  if (array(value.decorations, `${root}.decorations`, errors)) {
    idArray(value.decorations, `${root}.decorations`, errors);
    value.decorations.forEach((record, index) => {
      const p = `${root}.decorations[${index}]`;
      if (!object(record, p, ['id', 'x', 'y', 'kind', 'assetKey', 'variantIndex', 'anchor', 'featureId'], errors)) return;
      string(record.id, `${p}.id`, errors);
      integer(record.x, `${p}.x`, errors, { min: 0, max: dimensions.width - 1 });
      integer(record.y, `${p}.y`, errors, { min: 0, max: dimensions.height - 1 });
      string(record.kind, `${p}.kind`, errors);
      string(record.assetKey, `${p}.assetKey`, errors);
      integer(record.variantIndex, `${p}.variantIndex`, errors, { min: 0 });
      enumeration(record.anchor, `${p}.anchor`, TRANSITION_ANCHORS, errors);
      string(record.featureId, `${p}.featureId`, errors, { nullable: true });
    });
  }

  const refs = validateFeatureCollections(value.features, `${root}.features`, errors, dimensions);
  validateDiagnostics(value.diagnostics, `${root}.diagnostics`, errors, final);
  if (refs) validateReferences(value, root, refs, errors);
  return { valid: errors.length === 0, errors };
}

function validateReferences(map, root, { featureIds, regionIds }, errors) {
  const featureReference = (id, path) => {
    if (id !== null && !featureIds.has(id)) push(errors, path, `unknown feature id ${id}`);
  };
  const regionReference = (id, path) => {
    if (id !== null && !regionIds.has(id)) push(errors, path, `unknown region id ${id}`);
  };
  map.terrain?.forEach((row, y) => row?.forEach((cell, x) => regionReference(cell?.regionId, `${root}.terrain[${y}][${x}].regionId`)));
  map.features?.regions?.forEach((record, i) => {
    featureReference(record.parentFeatureId, `${root}.features.regions[${i}].parentFeatureId`);
    record.adjacentRegionIds?.forEach((id, j) => {
      regionReference(id, `${root}.features.regions[${i}].adjacentRegionIds[${j}]`);
      if (id === record.id) push(errors, `${root}.features.regions[${i}].adjacentRegionIds[${j}]`, 'cannot reference itself');
    });
  });
  map.features?.waterBodies?.forEach((record, i) => regionReference(record.parentRegionId, `${root}.features.waterBodies[${i}].parentRegionId`));
  map.features?.routes?.forEach((record, i) => record.anchorFeatureIds?.forEach((id, j) => featureReference(id, `${root}.features.routes[${i}].anchorFeatureIds[${j}]`)));
  map.features?.clearings?.forEach((record, i) => regionReference(record.parentRegionId, `${root}.features.clearings[${i}].parentRegionId`));
  map.features?.structures?.forEach((record, i) => regionReference(record.parentRegionId, `${root}.features.structures[${i}].parentRegionId`));
  for (const collection of ['elevationConnections', 'obstacles', 'variants', 'transitions', 'decorations']) {
    map[collection]?.forEach((record, i) => featureReference(record.featureId, `${root}.${collection}[${i}].featureId`));
  }
  map.diagnostics?.algorithms?.forEach((record, i) => record.outputFeatureIds?.forEach((id, j) => featureReference(id, `${root}.diagnostics.algorithms[${i}].outputFeatureIds[${j}]`)));
  map.diagnostics?.hardValidation?.checks?.forEach((record, i) => record.featureIds?.forEach((id, j) => featureReference(id, `${root}.diagnostics.hardValidation.checks[${i}].featureIds[${j}]`)));
  map.diagnostics?.tacticalValidation?.checks?.forEach((record, i) => record.featureIds?.forEach((id, j) => featureReference(id, `${root}.diagnostics.tacticalValidation.checks[${i}].featureIds[${j}]`)));

  const zoneIds = new Set(map.spawnLayout?.protectedZones?.map(zone => zone.id));
  map.spawnLayout?.exits?.forEach((exit, i) => {
    if (!zoneIds.has(exit.zoneId)) push(errors, `${root}.spawnLayout.exits[${i}].zoneId`, `unknown protected-zone id ${exit.zoneId}`);
  });
}

export function validateBattleMapV2Candidate(value) {
  return validateMap(value, false);
}

export function validateBattleMapV2Final(value) {
  return validateMap(value, true);
}

function assertion(result, name) {
  if (!result.valid) {
    const error = new TypeError(`${name} validation failed:\n${result.errors.join('\n')}`);
    error.code = 'INVALID_BATTLE_MAP_V2';
    error.validationErrors = result.errors;
    throw error;
  }
}

export function assertBattleMapV2Candidate(value) {
  assertion(validateBattleMapV2Candidate(value), 'BattleMapV2Candidate');
  return value;
}

export function assertBattleMapV2Final(value) {
  assertion(validateBattleMapV2Final(value), 'BattleMapV2Final');
  return value;
}

/**
 * Machine-readable shape manifest for architecture checks and documentation.
 * `fields` arrays are exhaustive at every serialized object level.
 */
export const BattleMapV2RecordShapes = Object.freeze({
  candidate: MAP_KEYS,
  final: MAP_KEYS,
  terrainCell: ['material', 'movementCost', 'passable', 'regionId'],
  elevationConnection: ['id', 'from', 'to', 'kind', 'direction', 'elevationDelta', 'bidirectional', 'featureId'],
  obstacle: ['id', 'x', 'y', 'kind', 'assetKey', 'blocking', 'movementCost', 'featureId'],
  spawnLayout: ['slots', 'protectedZones', 'stagingRegions', 'exits', 'minimumApproachExits'],
  spawnSlot: ['id', 'side', 'role', 'x', 'y', 'selected'],
  protectedZone: ['id', 'kind', 'side', 'bounds', 'minimumClearance'],
  stagingRegion: ['id', 'side', 'strategy', 'bounds', 'capacity'],
  spawnExit: ['id', 'zoneId', 'x', 'y'],
  variant: ['id', 'x', 'y', 'material', 'variantIndex', 'featureId'],
  transition: ['id', 'x', 'y', 'kind', 'directionMask', 'assetKey', 'anchor', 'stratum', 'precedence', 'featureId'],
  decoration: ['id', 'x', 'y', 'kind', 'assetKey', 'variantIndex', 'anchor', 'featureId'],
  region: ['id', 'kind', 'material', 'bounds', 'area', 'adjacentRegionIds', 'parentFeatureId'],
  waterBody: ['id', 'kind', 'material', 'bounds', 'cells', 'sourceCells', 'outletCell', 'parentRegionId'],
  route: ['id', 'kind', 'material', 'centerline', 'width', 'required', 'anchorFeatureIds'],
  clearing: ['id', 'kind', 'bounds', 'cells', 'parentRegionId'],
  structure: ['id', 'kind', 'assetKey', 'footprint', 'entrances', 'parentRegionId'],
  diagnostics: ['resolvedRecipe', 'attempt', 'streamVersion', 'hashVersion', 'algorithms', 'hardValidation', 'tacticalValidation', 'qualityMetrics'],
  finalHashes: ['authoritativeHash', 'visualHash', 'fullHash']
});
