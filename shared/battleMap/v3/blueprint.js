import { canonicalJsonBytes } from '../canonicalJson.js';
import { hashCanonicalV3Value } from './hashes.js';
import {
  SAFE_ID_PATTERN,
  array,
  assertion,
  boolean,
  enumeration,
  exactObject,
  integer,
  nonEmptyString,
  push,
  safeId,
  uniqueRecordIds,
  uniqueStrings
} from './validation.js';

export const TEMPLATE_MAP_BLUEPRINT_SCHEMA_VERSION = 1;
export const TEMPLATE_MAP_BLUEPRINT_HASH_DOMAIN =
  'modia:template-map-blueprint:v1';
export const TEMPLATE_MAP_BLUEPRINT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxStringLength: 4096,
  maxCollectionLength: 65536,
  maxDimension: 256
});

const DIRECTIONS = Object.freeze(['n', 'e', 's', 'w']);
const CONNECTION_KINDS = Object.freeze(['flat', 'slope', 'stairs', 'cliff']);
const ASSET_CATEGORIES = Object.freeze([
  'surface', 'connection', 'obstacle', 'decoration', 'boundary', 'route'
]);
const ROOT_KEYS = Object.freeze([
  'schemaVersion', 'candidateId', 'templateId', 'dimensions',
  'renderMask', 'playableMask', 'surfaceGrid', 'elevation',
  'regions', 'features', 'routes', 'connections', 'obstacles',
  'decorations', 'boundaries', 'spawn', 'expectedAssetFamilies',
  'generationNotes'
]);

function coordinate(value, path, errors, dimensions) {
  if (!exactObject(value, path, ['x', 'y'], errors)) return;
  integer(value.x, `${path}.x`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.y, `${path}.y`, errors, { min: 0, max: dimensions.height - 1 });
}

function coordinateKey(value) {
  return `${value?.x},${value?.y}`;
}

function coordinateList(value, path, errors, dimensions, { min = 0 } = {}) {
  if (!array(value, path, errors, { min })) return;
  const seen = new Set();
  value.forEach((item, index) => {
    coordinate(item, `${path}[${index}]`, errors, dimensions);
    const key = coordinateKey(item);
    if (seen.has(key)) push(errors, `${path}[${index}]`, `duplicate coordinate ${key}`);
    seen.add(key);
  });
}

function grid(value, path, errors, dimensions, cellValidator) {
  if (!array(value, path, errors)) return;
  if (value.length !== dimensions.height) push(errors, path, `must contain ${dimensions.height} rows`);
  value.forEach((row, y) => {
    if (!array(row, `${path}[${y}]`, errors)) return;
    if (row.length !== dimensions.width) {
      push(errors, `${path}[${y}]`, `must contain ${dimensions.width} cells`);
    }
    row.forEach((cell, x) => cellValidator(cell, `${path}[${y}][${x}]`, x, y));
  });
}

function bounds(value, path, errors, dimensions) {
  if (!exactObject(value, path, ['minX', 'minY', 'maxX', 'maxY'], errors)) return;
  integer(value.minX, `${path}.minX`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.minY, `${path}.minY`, errors, { min: 0, max: dimensions.height - 1 });
  integer(value.maxX, `${path}.maxX`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.maxY, `${path}.maxY`, errors, { min: 0, max: dimensions.height - 1 });
  if (Number.isSafeInteger(value.minX) && Number.isSafeInteger(value.maxX) && value.minX > value.maxX) {
    push(errors, path, 'minX must be <= maxX');
  }
  if (Number.isSafeInteger(value.minY) && Number.isSafeInteger(value.maxY) && value.minY > value.maxY) {
    push(errors, path, 'minY must be <= maxY');
  }
}

function validateJsonLimits(value, errors) {
  try {
    if (canonicalJsonBytes(value).byteLength > TEMPLATE_MAP_BLUEPRINT_LIMITS.maxBytes) {
      push(errors, 'TemplateMapBlueprint', `must not exceed ${TEMPLATE_MAP_BLUEPRINT_LIMITS.maxBytes} bytes`);
    }
  } catch (error) {
    push(errors, 'TemplateMapBlueprint', `must contain canonical JSON-only values (${error.message})`);
    return;
  }

  const visit = (item, path, depth) => {
    if (depth > TEMPLATE_MAP_BLUEPRINT_LIMITS.maxDepth) {
      push(errors, path, `must not exceed depth ${TEMPLATE_MAP_BLUEPRINT_LIMITS.maxDepth}`);
      return;
    }
    if (typeof item === 'string' && item.length > TEMPLATE_MAP_BLUEPRINT_LIMITS.maxStringLength) {
      push(errors, path, `string must not exceed ${TEMPLATE_MAP_BLUEPRINT_LIMITS.maxStringLength} characters`);
    }
    if (Array.isArray(item)) {
      if (item.length > TEMPLATE_MAP_BLUEPRINT_LIMITS.maxCollectionLength) {
        push(errors, path, `array must not exceed ${TEMPLATE_MAP_BLUEPRINT_LIMITS.maxCollectionLength} items`);
      }
      item.forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
    } else if (item && typeof item === 'object') {
      const keys = Object.keys(item);
      if (keys.length > TEMPLATE_MAP_BLUEPRINT_LIMITS.maxCollectionLength) {
        push(errors, path, `object must not exceed ${TEMPLATE_MAP_BLUEPRINT_LIMITS.maxCollectionLength} keys`);
      }
      keys.forEach(key => visit(item[key], `${path}.${key}`, depth + 1));
    }
  };
  visit(value, 'TemplateMapBlueprint', 0);
}

function validateLayers(value, errors, dimensions) {
  grid(value.renderMask, 'TemplateMapBlueprint.renderMask', errors, dimensions,
    (cell, path) => boolean(cell, path, errors));
  grid(value.playableMask, 'TemplateMapBlueprint.playableMask', errors, dimensions,
    (cell, path, x, y) => {
      boolean(cell, path, errors);
      if (cell === true && value.renderMask?.[y]?.[x] !== true) {
        push(errors, path, 'playable cell must also be rendered');
      }
    });
  grid(value.surfaceGrid, 'TemplateMapBlueprint.surfaceGrid', errors, dimensions,
    (cell, path, x, y) => {
      if (value.renderMask?.[y]?.[x] !== true) {
        if (cell !== null) push(errors, path, 'void cell must be null');
        return;
      }
      if (!exactObject(cell, path, ['material', 'featureId'], errors)) return;
      safeId(cell.material, `${path}.material`, errors);
      safeId(cell.featureId, `${path}.featureId`, errors);
    });
  grid(value.elevation, 'TemplateMapBlueprint.elevation', errors, dimensions,
    (cell, path, x, y) => {
      if (value.renderMask?.[y]?.[x] === true) integer(cell, path, errors, { min: -32, max: 32 });
      else if (cell !== null) push(errors, path, 'void cell must be null');
    });
}

function validateFeatureRecords(value, errors, dimensions) {
  const validate = (records, collectionPath, region) => {
    if (!array(records, collectionPath, errors)) return;
    uniqueRecordIds(records, collectionPath, errors);
    records.forEach((record, index) => {
      const path = `${collectionPath}[${index}]`;
      const keys = region
        ? ['id', 'kind', 'cells', 'annotations']
        : ['id', 'kind', 'cells', 'ownerFeatureId', 'annotations'];
      if (!exactObject(record, path, keys, errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      coordinateList(record.cells, `${path}.cells`, errors, dimensions, { min: 1 });
      if (!region && record.ownerFeatureId !== null) safeId(record.ownerFeatureId, `${path}.ownerFeatureId`, errors);
      uniqueStrings(record.annotations, `${path}.annotations`, errors);
    });
  };
  validate(value.regions, 'TemplateMapBlueprint.regions', true);
  validate(value.features, 'TemplateMapBlueprint.features', false);

  const ids = new Set();
  for (const collection of [value.regions, value.features]) {
    if (!Array.isArray(collection)) continue;
    collection.forEach((record, index) => {
      if (!record || typeof record.id !== 'string') return;
      if (ids.has(record.id)) push(errors, 'TemplateMapBlueprint.features', `duplicate feature identity ${record.id}`);
      ids.add(record.id);
      if (collection === value.features && record.ownerFeatureId !== null && !ids.has(record.ownerFeatureId)) {
        // A second pass below permits owners declared later.
      }
    });
  }
  if (Array.isArray(value.features)) value.features.forEach((record, index) => {
    const ownerFeatureId = record?.ownerFeatureId;
    if (
      typeof ownerFeatureId === 'string'
      && !ids.has(ownerFeatureId)
    ) {
      push(
        errors,
        `TemplateMapBlueprint.features[${index}].ownerFeatureId`,
        `unknown feature id ${ownerFeatureId}`
      );
    }
  });
  if (Array.isArray(value.surfaceGrid)) value.surfaceGrid.forEach((row, y) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, x) => {
      if (cell && !ids.has(cell.featureId)) {
        push(errors, `TemplateMapBlueprint.surfaceGrid[${y}][${x}].featureId`, `unknown feature id ${cell.featureId}`);
      }
    });
  });
  return ids;
}

function validateMapObjects(value, errors, dimensions, featureIds) {
  const checkFeature = (id, path) => {
    if (id !== null && !featureIds.has(id)) push(errors, path, `unknown feature id ${id}`);
  };
  if (array(value.routes, 'TemplateMapBlueprint.routes', errors)) {
    uniqueRecordIds(value.routes, 'TemplateMapBlueprint.routes', errors);
    value.routes.forEach((record, index) => {
      const path = `TemplateMapBlueprint.routes[${index}]`;
      if (!exactObject(record, path, [
        'id', 'kind', 'material', 'cells', 'required', 'width',
        'featureId', 'assetFamily'
      ], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      safeId(record.material, `${path}.material`, errors);
      coordinateList(record.cells, `${path}.cells`, errors, dimensions, { min: 1 });
      boolean(record.required, `${path}.required`, errors);
      integer(record.width, `${path}.width`, errors, { min: 1, max: 32 });
      safeId(record.featureId, `${path}.featureId`, errors);
      safeId(record.assetFamily, `${path}.assetFamily`, errors);
      checkFeature(record.featureId, `${path}.featureId`);
    });
  }
  if (array(value.connections, 'TemplateMapBlueprint.connections', errors)) {
    uniqueRecordIds(value.connections, 'TemplateMapBlueprint.connections', errors);
    const edges = new Set();
    value.connections.forEach((record, index) => {
      const path = `TemplateMapBlueprint.connections[${index}]`;
      if (!exactObject(record, path, [
        'id', 'from', 'to', 'kind', 'traversable', 'bidirectional',
        'featureId', 'assetFamily'
      ], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      coordinate(record.from, `${path}.from`, errors, dimensions);
      coordinate(record.to, `${path}.to`, errors, dimensions);
      enumeration(record.kind, `${path}.kind`, CONNECTION_KINDS, errors);
      boolean(record.traversable, `${path}.traversable`, errors);
      boolean(record.bidirectional, `${path}.bidirectional`, errors);
      if (record.featureId !== null) safeId(record.featureId, `${path}.featureId`, errors);
      safeId(record.assetFamily, `${path}.assetFamily`, errors);
      checkFeature(record.featureId, `${path}.featureId`);
      const endpoints = [coordinateKey(record.from), coordinateKey(record.to)].sort();
      const edge = endpoints.join('~');
      if (edges.has(edge)) push(errors, path, `ambiguous duplicate connection edge ${edge}`);
      edges.add(edge);
    });
  }
  if (array(value.obstacles, 'TemplateMapBlueprint.obstacles', errors)) {
    uniqueRecordIds(value.obstacles, 'TemplateMapBlueprint.obstacles', errors);
    value.obstacles.forEach((record, index) => {
      const path = `TemplateMapBlueprint.obstacles[${index}]`;
      if (!exactObject(record, path, [
        'id', 'kind', 'cells', 'featureId', 'anchor', 'occlusionBounds', 'assetFamily'
      ], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      coordinateList(record.cells, `${path}.cells`, errors, dimensions, { min: 1 });
      if (record.featureId !== null) safeId(record.featureId, `${path}.featureId`, errors);
      coordinate(record.anchor, `${path}.anchor`, errors, dimensions);
      bounds(record.occlusionBounds, `${path}.occlusionBounds`, errors, dimensions);
      safeId(record.assetFamily, `${path}.assetFamily`, errors);
      checkFeature(record.featureId, `${path}.featureId`);
    });
  }
  if (array(value.decorations, 'TemplateMapBlueprint.decorations', errors)) {
    uniqueRecordIds(value.decorations, 'TemplateMapBlueprint.decorations', errors);
    value.decorations.forEach((record, index) => {
      const path = `TemplateMapBlueprint.decorations[${index}]`;
      if (!exactObject(record, path, [
        'id', 'kind', 'cell', 'featureId', 'anchor', 'assetFamily'
      ], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      coordinate(record.cell, `${path}.cell`, errors, dimensions);
      if (record.featureId !== null) safeId(record.featureId, `${path}.featureId`, errors);
      enumeration(record.anchor, `${path}.anchor`, ['tile', 'edge', 'scene'], errors);
      safeId(record.assetFamily, `${path}.assetFamily`, errors);
      checkFeature(record.featureId, `${path}.featureId`);
    });
  }
  if (array(value.boundaries, 'TemplateMapBlueprint.boundaries', errors)) {
    uniqueRecordIds(value.boundaries, 'TemplateMapBlueprint.boundaries', errors);
    value.boundaries.forEach((record, index) => {
      const path = `TemplateMapBlueprint.boundaries[${index}]`;
      if (!exactObject(record, path, [
        'id', 'kind', 'edges', 'featureId', 'sceneOnly', 'assetFamily'
      ], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      if (array(record.edges, `${path}.edges`, errors, { min: 1 })) {
        const edges = new Set();
        record.edges.forEach((edge, edgeIndex) => {
          const edgePath = `${path}.edges[${edgeIndex}]`;
          if (!exactObject(edge, edgePath, ['cell', 'direction'], errors)) return;
          coordinate(edge.cell, `${edgePath}.cell`, errors, dimensions);
          enumeration(edge.direction, `${edgePath}.direction`, DIRECTIONS, errors);
          const key = `${coordinateKey(edge.cell)}:${edge.direction}`;
          if (edges.has(key)) push(errors, edgePath, `duplicate boundary edge ${key}`);
          edges.add(key);
        });
      }
      safeId(record.featureId, `${path}.featureId`, errors);
      boolean(record.sceneOnly, `${path}.sceneOnly`, errors);
      safeId(record.assetFamily, `${path}.assetFamily`, errors);
      checkFeature(record.featureId, `${path}.featureId`);
    });
  }
}

function validateMapObjectSemantics(value, errors, dimensions) {
  const validCoordinate = cell =>
    Number.isSafeInteger(cell?.x)
    && Number.isSafeInteger(cell?.y)
    && cell.x >= 0
    && cell.x < dimensions.width
    && cell.y >= 0
    && cell.y < dimensions.height;
  const outsidePlayableMask = cell =>
    validCoordinate(cell) && value.playableMask?.[cell.y]?.[cell.x] === false;
  const obstacleCells = new Set();
  if (Array.isArray(value.obstacles)) {
    value.obstacles.forEach(obstacle => {
      if (!Array.isArray(obstacle?.cells)) return;
      obstacle.cells.forEach(cell => {
        if (validCoordinate(cell)) obstacleCells.add(coordinateKey(cell));
      });
    });
  }

  if (Array.isArray(value.routes)) {
    value.routes.forEach((route, routeIndex) => {
      if (route?.required !== true || !Array.isArray(route.cells)) return;
      const path = `TemplateMapBlueprint.routes[${routeIndex}].cells`;
      route.cells.forEach((cell, cellIndex) => {
        if (cellIndex > 0) {
          const previous = route.cells[cellIndex - 1];
          if (validCoordinate(previous) && validCoordinate(cell)) {
            const manhattanDistance =
              Math.abs(previous.x - cell.x) + Math.abs(previous.y - cell.y);
            if (manhattanDistance !== 1) {
              push(
                errors,
                `${path}[${cellIndex}]`,
                'required route centerline step must be cardinal (Manhattan distance must equal 1)'
              );
            }
          }
        }
        if (outsidePlayableMask(cell)) {
          push(errors, `${path}[${cellIndex}]`, 'required route cell must be playable');
        }
        if (validCoordinate(cell) && obstacleCells.has(coordinateKey(cell))) {
          push(
            errors,
            `${path}[${cellIndex}]`,
            'required route cell must not overlap an obstacle cell'
          );
        }
      });
    });
  }

  if (Array.isArray(value.obstacles)) {
    value.obstacles.forEach((obstacle, obstacleIndex) => {
      if (!Array.isArray(obstacle?.cells)) return;
      obstacle.cells.forEach((cell, cellIndex) => {
        if (outsidePlayableMask(cell)) {
          push(
            errors,
            `TemplateMapBlueprint.obstacles[${obstacleIndex}].cells[${cellIndex}]`,
            'obstacle cell must be playable'
          );
        }
      });
    });
  }
}

function validateSpawn(value, errors, dimensions) {
  const spawn = value.spawn;
  const path = 'TemplateMapBlueprint.spawn';
  const keys = [
    'capacities', 'formationFacing', 'playerSlots', 'opponentCandidates',
    'opponentZones', 'protectedClearances', 'exits', 'approachRegions',
    'minimumRouteConstraints', 'tacticalAnnotations'
  ];
  if (!exactObject(spawn, path, keys, errors)) return;
  if (exactObject(spawn.capacities, `${path}.capacities`, [
    'playerCapacity', 'candidatePoolSize', 'maxAssignableOpponents'
  ], errors)) {
    integer(spawn.capacities.playerCapacity, `${path}.capacities.playerCapacity`, errors, { min: 1, max: 5 });
    integer(spawn.capacities.candidatePoolSize, `${path}.capacities.candidatePoolSize`, errors, { min: 1, max: 65536 });
    integer(spawn.capacities.maxAssignableOpponents, `${path}.capacities.maxAssignableOpponents`, errors, { min: 1, max: 64 });
    if (spawn.capacities.maxAssignableOpponents > spawn.capacities.candidatePoolSize) {
      push(errors, `${path}.capacities`, 'maxAssignableOpponents must not exceed candidatePoolSize');
    }
  }
  if (exactObject(spawn.formationFacing, `${path}.formationFacing`, ['player', 'opponent'], errors)) {
    enumeration(spawn.formationFacing.player, `${path}.formationFacing.player`, DIRECTIONS, errors);
    enumeration(spawn.formationFacing.opponent, `${path}.formationFacing.opponent`, DIRECTIONS, errors);
  }
  const pointRecord = (record, itemPath, keysToUse) => {
    if (!exactObject(record, itemPath, keysToUse, errors)) return;
    safeId(record.id, `${itemPath}.id`, errors);
    coordinate(record.cell, `${itemPath}.cell`, errors, dimensions);
    uniqueStrings(record.tags, `${itemPath}.tags`, errors);
  };
  if (array(spawn.playerSlots, `${path}.playerSlots`, errors, { min: 1 })) {
    uniqueRecordIds(spawn.playerSlots, `${path}.playerSlots`, errors);
    spawn.playerSlots.forEach((record, index) => {
      const itemPath = `${path}.playerSlots[${index}]`;
      pointRecord(record, itemPath, ['id', 'cell', 'role', 'tags']);
      safeId(record?.role, `${itemPath}.role`, errors);
    });
  }
  if (array(spawn.opponentCandidates, `${path}.opponentCandidates`, errors, { min: 1 })) {
    uniqueRecordIds(spawn.opponentCandidates, `${path}.opponentCandidates`, errors);
    spawn.opponentCandidates.forEach((record, index) => {
      const itemPath = `${path}.opponentCandidates[${index}]`;
      pointRecord(record, itemPath, [
        'id', 'cell', 'tags', 'zoneId', 'minimumClearance', 'tacticalAnnotationIds'
      ]);
      if (record?.zoneId !== null) safeId(record.zoneId, `${itemPath}.zoneId`, errors);
      integer(record?.minimumClearance, `${itemPath}.minimumClearance`, errors, { min: 0, max: 32 });
      uniqueStrings(record?.tacticalAnnotationIds, `${itemPath}.tacticalAnnotationIds`, errors);
    });
  }
  if (array(spawn.opponentZones, `${path}.opponentZones`, errors)) {
    uniqueRecordIds(spawn.opponentZones, `${path}.opponentZones`, errors);
    spawn.opponentZones.forEach((record, index) => {
      const itemPath = `${path}.opponentZones[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'cells', 'tags', 'capacity'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      coordinateList(record.cells, `${itemPath}.cells`, errors, dimensions, { min: 1 });
      uniqueStrings(record.tags, `${itemPath}.tags`, errors);
      integer(record.capacity, `${itemPath}.capacity`, errors, { min: 1 });
    });
  }
  if (array(spawn.protectedClearances, `${path}.protectedClearances`, errors)) {
    uniqueRecordIds(spawn.protectedClearances, `${path}.protectedClearances`, errors);
    spawn.protectedClearances.forEach((record, index) => {
      const itemPath = `${path}.protectedClearances[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'side', 'anchorId', 'radius'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      enumeration(record.side, `${itemPath}.side`, ['player', 'opponent'], errors);
      safeId(record.anchorId, `${itemPath}.anchorId`, errors);
      integer(record.radius, `${itemPath}.radius`, errors, { min: 0, max: 32 });
    });
  }
  if (array(spawn.exits, `${path}.exits`, errors, { min: 1 })) {
    uniqueRecordIds(spawn.exits, `${path}.exits`, errors);
    spawn.exits.forEach((record, index) => {
      const itemPath = `${path}.exits[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'side', 'cell', 'approachRegionId'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      enumeration(record.side, `${itemPath}.side`, ['player', 'opponent'], errors);
      coordinate(record.cell, `${itemPath}.cell`, errors, dimensions);
      safeId(record.approachRegionId, `${itemPath}.approachRegionId`, errors);
    });
  }
  if (array(spawn.approachRegions, `${path}.approachRegions`, errors, { min: 1 })) {
    uniqueRecordIds(spawn.approachRegions, `${path}.approachRegions`, errors);
    spawn.approachRegions.forEach((record, index) => {
      const itemPath = `${path}.approachRegions[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'side', 'cells'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      enumeration(record.side, `${itemPath}.side`, ['player', 'opponent'], errors);
      coordinateList(record.cells, `${itemPath}.cells`, errors, dimensions, { min: 1 });
    });
  }
  if (exactObject(spawn.minimumRouteConstraints, `${path}.minimumRouteConstraints`, [
    'minimumIndependentExits', 'requireMutualReachability',
    'maximumTraversableElevationDelta'
  ], errors)) {
    integer(spawn.minimumRouteConstraints.minimumIndependentExits,
      `${path}.minimumRouteConstraints.minimumIndependentExits`, errors, { min: 1 });
    boolean(spawn.minimumRouteConstraints.requireMutualReachability,
      `${path}.minimumRouteConstraints.requireMutualReachability`, errors);
    integer(spawn.minimumRouteConstraints.maximumTraversableElevationDelta,
      `${path}.minimumRouteConstraints.maximumTraversableElevationDelta`, errors, { min: 0, max: 1 });
  }
  if (array(spawn.tacticalAnnotations, `${path}.tacticalAnnotations`, errors)) {
    uniqueRecordIds(spawn.tacticalAnnotations, `${path}.tacticalAnnotations`, errors);
    spawn.tacticalAnnotations.forEach((record, index) => {
      const itemPath = `${path}.tacticalAnnotations[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'kind', 'cells', 'tags'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      safeId(record.kind, `${itemPath}.kind`, errors);
      coordinateList(record.cells, `${itemPath}.cells`, errors, dimensions, { min: 1 });
      uniqueStrings(record.tags, `${itemPath}.tags`, errors);
    });
  }
}

function validateExpectedAssets(value, errors) {
  const path = 'TemplateMapBlueprint.expectedAssetFamilies';
  if (!array(value.expectedAssetFamilies, path, errors, { min: 1 })) return;
  const seen = new Set();
  value.expectedAssetFamilies.forEach((record, index) => {
    const itemPath = `${path}[${index}]`;
    if (!exactObject(record, itemPath, ['category', 'symbol'], errors)) return;
    enumeration(record.category, `${itemPath}.category`, ASSET_CATEGORIES, errors);
    safeId(record.symbol, `${itemPath}.symbol`, errors);
    const key = `${record.category}:${record.symbol}`;
    if (seen.has(key)) push(errors, itemPath, `duplicate expected asset family ${key}`);
    seen.add(key);
  });
}

export function validateTemplateMapBlueprint(value) {
  const errors = [];
  validateJsonLimits(value, errors);
  if (!exactObject(value, 'TemplateMapBlueprint', ROOT_KEYS, errors)) {
    return { valid: false, errors };
  }
  if (value.schemaVersion !== TEMPLATE_MAP_BLUEPRINT_SCHEMA_VERSION) {
    push(errors, 'TemplateMapBlueprint.schemaVersion', `must equal ${TEMPLATE_MAP_BLUEPRINT_SCHEMA_VERSION}`);
  }
  safeId(value.candidateId, 'TemplateMapBlueprint.candidateId', errors);
  safeId(value.templateId, 'TemplateMapBlueprint.templateId', errors);
  if (exactObject(value.dimensions, 'TemplateMapBlueprint.dimensions', ['width', 'height'], errors)) {
    integer(value.dimensions.width, 'TemplateMapBlueprint.dimensions.width', errors,
      { min: 1, max: TEMPLATE_MAP_BLUEPRINT_LIMITS.maxDimension });
    integer(value.dimensions.height, 'TemplateMapBlueprint.dimensions.height', errors,
      { min: 1, max: TEMPLATE_MAP_BLUEPRINT_LIMITS.maxDimension });
  }
  const dimensions = {
    width: Number.isSafeInteger(value.dimensions?.width) && value.dimensions.width > 0
      ? value.dimensions.width : 1,
    height: Number.isSafeInteger(value.dimensions?.height) && value.dimensions.height > 0
      ? value.dimensions.height : 1
  };
  validateLayers(value, errors, dimensions);
  const featureIds = validateFeatureRecords(value, errors, dimensions) ?? new Set();
  validateMapObjects(value, errors, dimensions, featureIds);
  validateMapObjectSemantics(value, errors, dimensions);
  validateSpawn(value, errors, dimensions);
  validateExpectedAssets(value, errors);
  if (array(value.generationNotes, 'TemplateMapBlueprint.generationNotes', errors)) {
    value.generationNotes.forEach((note, index) => {
      nonEmptyString(note, `TemplateMapBlueprint.generationNotes[${index}]`, errors);
    });
  }
  return { valid: errors.length === 0, errors };
}

export function assertTemplateMapBlueprint(value) {
  assertion(
    validateTemplateMapBlueprint(value),
    'TemplateMapBlueprint',
    'INVALID_TEMPLATE_MAP_BLUEPRINT'
  );
  return value;
}

export async function computeTemplateMapBlueprintFullHash(value) {
  assertTemplateMapBlueprint(value);
  return hashCanonicalV3Value(TEMPLATE_MAP_BLUEPRINT_HASH_DOMAIN, value);
}

export const TemplateMapBlueprintRecordShapes = Object.freeze({
  root: ROOT_KEYS,
  expectedAsset: ['category', 'symbol'],
  safeIdPattern: SAFE_ID_PATTERN.source
});
