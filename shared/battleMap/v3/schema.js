import {
  array,
  assertion,
  boolean,
  enumeration,
  exactObject,
  finite,
  integer,
  nonEmptyString,
  push,
  safeId,
  sha256,
  uniqueRecordIds,
  uniqueStrings
} from './validation.js';

export const BATTLE_MAP_V3_SCHEMA_VERSION = 3;
export const BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION = 3;
export const BATTLE_MAP_V3_HASH_VERSION = 'sha256-cjson-v1';
export const BATTLE_MAP_V3_MAX_DIMENSION = 256;
export const BATTLE_MAP_V3_DIRECTIONS = Object.freeze(['n', 'e', 's', 'w']);
export const BATTLE_MAP_V3_CONNECTION_KINDS = Object.freeze(['flat', 'slope', 'stairs', 'cliff']);

const MAP_KEYS = Object.freeze([
  'battleMapSchemaVersion', 'terrainGenerationVersion', 'contentId',
  'contentVersion', 'templateId', 'templateRevision', 'theme',
  'renderProfileId', 'tierEligibility', 'supportedModes', 'dimensions',
  'provenance', 'renderMask', 'playableMask', 'terrain', 'elevation',
  'elevationConnections', 'visualCells', 'obstacles', 'decorations',
  'boundaries', 'routes', 'features', 'spawnContract', 'hashVersion'
]);
const OPTIONAL_MAP_KEYS = Object.freeze(['ecologyProfile', 'scene']);
const FINAL_MAP_KEYS = Object.freeze([...MAP_KEYS, ...OPTIONAL_MAP_KEYS, 'hashes']);
const SCENE_SILHOUETTES = Object.freeze([
  'organic-island', 'rectangular-platform'
]);
const SCENE_EXTERIORS = Object.freeze([
  'forest-canopy', 'cave-rock', 'mountain-crag', 'architectural-skirt', 'none'
]);
const SCENE_BACKDROPS = Object.freeze([
  'sky-gradient', 'cavern-gradient', 'architectural-gradient'
]);
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function coord(value, path, errors, dimensions) {
  if (!exactObject(value, path, ['x', 'y'], errors)) return;
  integer(value.x, `${path}.x`, errors, { min: 0, max: dimensions.width - 1 });
  integer(value.y, `${path}.y`, errors, { min: 0, max: dimensions.height - 1 });
}

function coordKey(value) {
  return `${value?.x},${value?.y}`;
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

function coordList(value, path, errors, dimensions, { min = 0 } = {}) {
  if (!array(value, path, errors, { min })) return;
  const seen = new Set();
  value.forEach((item, index) => {
    coord(item, `${path}[${index}]`, errors, dimensions);
    const key = coordKey(item);
    if (seen.has(key)) push(errors, `${path}[${index}]`, `duplicate coordinate ${key}`);
    seen.add(key);
  });
}

function grid(value, path, errors, dimensions, validateCell) {
  if (!array(value, path, errors)) return;
  if (value.length !== dimensions.height) push(errors, path, `must contain ${dimensions.height} rows`);
  value.forEach((row, y) => {
    if (!array(row, `${path}[${y}]`, errors)) return;
    if (row.length !== dimensions.width) {
      push(errors, `${path}[${y}]`, `must contain ${dimensions.width} cells`);
    }
    row.forEach((cell, x) => validateCell(cell, `${path}[${y}][${x}]`, x, y));
  });
}

function versionedPin(value, path, errors, hashKey = 'fullHash') {
  if (!exactObject(value, path, ['id', 'version', hashKey], errors)) return;
  safeId(value.id, `${path}.id`, errors);
  integer(value.version, `${path}.version`, errors, { min: 1 });
  sha256(value[hashKey], `${path}.${hashKey}`, errors);
}

function validateProvenance(value, path, errors) {
  const keys = [
    'sourceSidecar', 'approvedBlueprint', 'assetBundle', 'tileCatalog',
    'compiler', 'validator'
  ];
  if (!exactObject(value, path, keys, errors)) return;
  versionedPin(value.sourceSidecar, `${path}.sourceSidecar`, errors);
  versionedPin(value.approvedBlueprint, `${path}.approvedBlueprint`, errors);
  versionedPin(value.assetBundle, `${path}.assetBundle`, errors, 'manifestFullHash');
  versionedPin(value.tileCatalog, `${path}.tileCatalog`, errors);
  versionedPin(value.compiler, `${path}.compiler`, errors);
  versionedPin(value.validator, `${path}.validator`, errors);
}

function immutableUrl(value, path, errors) {
  if (!nonEmptyString(value, path, errors)) return;
  try {
    const rootRelative = value.startsWith('/') && !value.startsWith('//');
    const parsed = new URL(value, rootRelative ? 'https://modia.invalid' : undefined);
    if ((!rootRelative && parsed.protocol !== 'https:')
      || parsed.username || parsed.password || parsed.hash || parsed.search
      || value.includes('\\')) {
      push(errors, path, 'must be a root-relative or HTTPS immutable URL without credentials, query, fragment, or backslash');
    }
    if (rootRelative && parsed.pathname !== value) {
      push(errors, path, 'root-relative URL must not contain traversal or normalization segments');
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.some(segment => {
      try {
        const decoded = decodeURIComponent(segment);
        return decoded === '.' || decoded === '..' || decoded.includes('/');
      } catch {
        return true;
      }
    })) {
      push(errors, path, 'must not contain encoded traversal or path separators');
    }
  } catch {
    push(errors, path, 'must be a strict root-relative or absolute HTTPS URL');
  }
}

function assetRef(value, path, errors, assetBundleId) {
  const keys = ['assetBundleId', 'key', 'contentVersion', 'contentHash', 'immutableUrl'];
  if (!exactObject(value, path, keys, errors)) return;
  safeId(value.assetBundleId, `${path}.assetBundleId`, errors);
  if (value.assetBundleId !== assetBundleId) {
    push(errors, `${path}.assetBundleId`, `must equal pinned asset bundle ${assetBundleId}`);
  }
  safeId(value.key, `${path}.key`, errors);
  integer(value.contentVersion, `${path}.contentVersion`, errors, { min: 1 });
  sha256(value.contentHash, `${path}.contentHash`, errors);
  immutableUrl(value.immutableUrl, `${path}.immutableUrl`, errors);
}

function edge(value, path, errors, dimensions) {
  if (!exactObject(value, path, ['cell', 'direction'], errors)) return;
  coord(value.cell, `${path}.cell`, errors, dimensions);
  enumeration(value.direction, `${path}.direction`, BATTLE_MAP_V3_DIRECTIONS, errors);
}

function validateScene(value, path, errors) {
  if (!exactObject(value, path, ['silhouette', 'exterior', 'backdrop'], errors)) return;
  enumeration(value.silhouette, `${path}.silhouette`, SCENE_SILHOUETTES, errors);
  enumeration(value.exterior, `${path}.exterior`, SCENE_EXTERIORS, errors);
  if (!exactObject(value.backdrop, `${path}.backdrop`, [
    'kind', 'topColor', 'horizonColor', 'bottomColor', 'hazeColor'
  ], errors)) return;
  enumeration(value.backdrop.kind, `${path}.backdrop.kind`, SCENE_BACKDROPS, errors);
  for (const key of ['topColor', 'horizonColor', 'bottomColor', 'hazeColor']) {
    if (typeof value.backdrop[key] !== 'string'
      || !HEX_COLOR_PATTERN.test(value.backdrop[key])) {
      push(errors, `${path}.backdrop.${key}`, 'must be a #RRGGBB color');
    }
  }
}

function terrainCell(value, path, errors) {
  if (value === null) return;
  if (!exactObject(value, path, ['material', 'passable', 'movementCost', 'featureId'], errors)) return;
  safeId(value.material, `${path}.material`, errors);
  boolean(value.passable, `${path}.passable`, errors);
  finite(value.movementCost, `${path}.movementCost`, errors, { min: 0 });
  if (value.featureId !== null) safeId(value.featureId, `${path}.featureId`, errors);
}

function validateLayers(map, root, errors, dimensions) {
  grid(map.renderMask, `${root}.renderMask`, errors, dimensions, (cell, path) => boolean(cell, path, errors));
  grid(map.playableMask, `${root}.playableMask`, errors, dimensions, (cell, path, x, y) => {
    boolean(cell, path, errors);
    if (cell === true && map.renderMask?.[y]?.[x] !== true) {
      push(errors, path, 'playable cell must also be rendered');
    }
  });
  grid(map.terrain, `${root}.terrain`, errors, dimensions, (cell, path, x, y) => {
    terrainCell(cell, path, errors);
    if (map.renderMask?.[y]?.[x] === true && cell === null) {
      push(errors, path, 'rendered cell must resolve terrain semantics');
    }
    if (map.renderMask?.[y]?.[x] === false && cell !== null) {
      push(errors, path, 'void cell terrain must be null');
    }
  });
  grid(map.elevation, `${root}.elevation`, errors, dimensions, (cell, path, x, y) => {
    if (map.renderMask?.[y]?.[x] === true) integer(cell, path, errors, { min: -32, max: 32 });
    else if (cell !== null) push(errors, path, 'void cell elevation must be null');
  });
  const bundleId = map.provenance?.assetBundle?.id;
  grid(map.visualCells, `${root}.visualCells`, errors, dimensions, (cell, path, x, y) => {
    const rendered = map.renderMask?.[y]?.[x] === true;
    if (!rendered) {
      if (cell !== null) push(errors, path, 'void cell visual record must be null');
      return;
    }
    if (!exactObject(cell, path, ['surface', 'overlays'], errors)) return;
    assetRef(cell.surface, `${path}.surface`, errors, bundleId);
    if (array(cell.overlays, `${path}.overlays`, errors)) {
      cell.overlays.forEach((item, index) => assetRef(item, `${path}.overlays[${index}]`, errors, bundleId));
    }
  });
}

function validateConnections(map, root, errors, dimensions) {
  if (!array(map.elevationConnections, `${root}.elevationConnections`, errors)) return;
  uniqueRecordIds(map.elevationConnections, `${root}.elevationConnections`, errors);
  const directedEdges = new Set();
  map.elevationConnections.forEach((record, index) => {
    const path = `${root}.elevationConnections[${index}]`;
    const keys = ['id', 'from', 'to', 'direction', 'kind', 'heightDelta', 'traversable', 'bidirectional', 'featureId', 'asset'];
    if (!exactObject(record, path, keys, errors)) return;
    safeId(record.id, `${path}.id`, errors);
    coord(record.from, `${path}.from`, errors, dimensions);
    coord(record.to, `${path}.to`, errors, dimensions);
    enumeration(record.direction, `${path}.direction`, BATTLE_MAP_V3_DIRECTIONS, errors);
    enumeration(record.kind, `${path}.kind`, BATTLE_MAP_V3_CONNECTION_KINDS, errors);
    integer(record.heightDelta, `${path}.heightDelta`, errors, { min: -64, max: 64 });
    boolean(record.traversable, `${path}.traversable`, errors);
    boolean(record.bidirectional, `${path}.bidirectional`, errors);
    if (record.featureId !== null) safeId(record.featureId, `${path}.featureId`, errors);
    if (
      record.kind === 'stairs'
      || (record.kind === 'slope' && map.ecologyProfile !== undefined)
    ) {
      assetRef(record.asset, `${path}.asset`, errors, map.provenance?.assetBundle?.id);
    } else if (record.asset !== null) {
      // Pre-release V3 artifacts may carry a legacy visual reference on a
      // non-stair connection. Keep them readable, while compiler v2 emits
      // null so traversal slopes cannot masquerade as discrete stairs.
      assetRef(record.asset, `${path}.asset`, errors, map.provenance?.assetBundle?.id);
    }
    const dx = record.to?.x - record.from?.x;
    const dy = record.to?.y - record.from?.y;
    const expected = dx === 1 && dy === 0 ? 'e' : dx === -1 && dy === 0 ? 'w'
      : dx === 0 && dy === 1 ? 's' : dx === 0 && dy === -1 ? 'n' : null;
    const directedEdge = `${coordKey(record.from)}>${coordKey(record.to)}`;
    if (directedEdges.has(directedEdge)) push(errors, path, `duplicate directed connection edge ${directedEdge}`);
    directedEdges.add(directedEdge);
    if (expected === null) push(errors, path, 'endpoints must be cardinal neighbors');
    else if (record.direction !== expected) push(errors, `${path}.direction`, `must equal ${expected}`);
    const fromLevel = map.elevation?.[record.from?.y]?.[record.from?.x];
    const toLevel = map.elevation?.[record.to?.y]?.[record.to?.x];
    if (Number.isSafeInteger(fromLevel) && Number.isSafeInteger(toLevel)
      && record.heightDelta !== toLevel - fromLevel) {
      push(errors, `${path}.heightDelta`, `must equal elevation delta ${toLevel - fromLevel}`);
    }
    if (record.traversable === true) {
      if (Math.abs(record.heightDelta) > 1) push(errors, path, 'traversable elevation delta must be at most one');
      if (record.kind === 'cliff') push(errors, `${path}.kind`, 'a cliff cannot be traversable');
      if (record.heightDelta === 0 && record.kind !== 'flat') {
        push(errors, `${path}.kind`, 'a level traversable connection must be flat');
      }
      if (Math.abs(record.heightDelta) === 1 && !['slope', 'stairs'].includes(record.kind)) {
        push(errors, `${path}.kind`, 'a traversable one-level delta must be a slope or stairs');
      }
      for (const point of [record.from, record.to]) {
        if (map.playableMask?.[point?.y]?.[point?.x] !== true
          || map.terrain?.[point?.y]?.[point?.x]?.passable !== true) {
          push(errors, path, 'traversable endpoints must be playable and passable');
          break;
        }
      }
    } else if (Math.abs(record.heightDelta) > 1 && record.kind !== 'cliff') {
      push(errors, `${path}.kind`, 'a nontraversable multi-level delta must be a cliff');
    }
    for (const point of [record.from, record.to]) {
      if (map.renderMask?.[point?.y]?.[point?.x] !== true) {
        push(errors, path, 'connection endpoints must be rendered');
        break;
      }
    }
  });
}

function validateObjects(map, root, errors, dimensions) {
  const bundleId = map.provenance?.assetBundle?.id;
  if (array(map.obstacles, `${root}.obstacles`, errors)) {
    uniqueRecordIds(map.obstacles, `${root}.obstacles`, errors);
    map.obstacles.forEach((record, index) => {
      const path = `${root}.obstacles[${index}]`;
      const keys = ['id', 'kind', 'cells', 'blocking', 'movementCost', 'featureId', 'anchor', 'occlusionBounds', 'asset'];
      if (!exactObject(record, path, keys, errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      coordList(record.cells, `${path}.cells`, errors, dimensions, { min: 1 });
      boolean(record.blocking, `${path}.blocking`, errors);
      if (record.blocking !== true) push(errors, `${path}.blocking`, 'must equal true for an obstacle');
      finite(record.movementCost, `${path}.movementCost`, errors, { min: 0 });
      if (record.featureId !== null) safeId(record.featureId, `${path}.featureId`, errors);
      coord(record.anchor, `${path}.anchor`, errors, dimensions);
      bounds(record.occlusionBounds, `${path}.occlusionBounds`, errors, dimensions);
      assetRef(record.asset, `${path}.asset`, errors, bundleId);
      if (Array.isArray(record.cells)) record.cells.forEach((cell, cellIndex) => {
        if (map.playableMask?.[cell?.y]?.[cell?.x] !== true) {
          push(errors, `${path}.cells[${cellIndex}]`, 'obstacle cells must be playable');
        }
      });
      if (map.renderMask?.[record.anchor?.y]?.[record.anchor?.x] !== true) {
        push(errors, `${path}.anchor`, 'obstacle anchor must be rendered');
      }
    });
  }
  if (array(map.decorations, `${root}.decorations`, errors)) {
    uniqueRecordIds(map.decorations, `${root}.decorations`, errors);
    map.decorations.forEach((record, index) => {
      const path = `${root}.decorations[${index}]`;
      if (!exactObject(record, path, ['id', 'kind', 'cell', 'featureId', 'anchor', 'asset'], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      coord(record.cell, `${path}.cell`, errors, dimensions);
      if (record.featureId !== null) safeId(record.featureId, `${path}.featureId`, errors);
      enumeration(record.anchor, `${path}.anchor`, ['tile', 'edge', 'scene'], errors);
      assetRef(record.asset, `${path}.asset`, errors, bundleId);
      if (map.renderMask?.[record.cell?.y]?.[record.cell?.x] !== true) {
        push(errors, `${path}.cell`, 'decoration cell must be rendered');
      }
    });
  }
  if (array(map.boundaries, `${root}.boundaries`, errors)) {
    uniqueRecordIds(map.boundaries, `${root}.boundaries`, errors);
    map.boundaries.forEach((record, index) => {
      const path = `${root}.boundaries[${index}]`;
      const keys = ['id', 'kind', 'edges', 'featureId', 'sceneOnly', 'asset'];
      if (
        record?.kind === 'elevation-face'
        && Object.hasOwn(record, 'levelOffset')
      ) keys.push('levelOffset');
      if (!exactObject(record, path, keys, errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      if (Object.hasOwn(record, 'levelOffset')) {
        integer(record.levelOffset, `${path}.levelOffset`, errors, {
          min: 2,
          max: 64
        });
      }
      if (array(record.edges, `${path}.edges`, errors, { min: 1 })) {
        record.edges.forEach((item, edgeIndex) => edge(item, `${path}.edges[${edgeIndex}]`, errors, dimensions));
      }
      safeId(record.featureId, `${path}.featureId`, errors);
      boolean(record.sceneOnly, `${path}.sceneOnly`, errors);
      assetRef(record.asset, `${path}.asset`, errors, bundleId);
      if (Array.isArray(record.edges)) record.edges.forEach((item, edgeIndex) => {
        if (map.renderMask?.[item?.cell?.y]?.[item?.cell?.x] !== true) {
          push(errors, `${path}.edges[${edgeIndex}].cell`, 'boundary edge cell must be rendered');
        }
      });
    });
  }
}

function validateFeaturesAndRoutes(map, root, errors, dimensions) {
  if (array(map.features, `${root}.features`, errors)) {
    const ids = uniqueRecordIds(map.features, `${root}.features`, errors);
    map.features.forEach((record, index) => {
      const path = `${root}.features[${index}]`;
      if (!exactObject(record, path, ['id', 'kind', 'cells', 'ownerFeatureId', 'annotations'], errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      coordList(record.cells, `${path}.cells`, errors, dimensions, { min: 1 });
      if (record.ownerFeatureId !== null) safeId(record.ownerFeatureId, `${path}.ownerFeatureId`, errors);
      uniqueStrings(record.annotations, `${path}.annotations`, errors);
    });
    map.features.forEach((record, index) => {
      if (record && record.ownerFeatureId !== null && !ids.has(record.ownerFeatureId)) {
        push(errors, `${root}.features[${index}].ownerFeatureId`, `unknown feature id ${record.ownerFeatureId}`);
      }
    });
  }
  if (array(map.routes, `${root}.routes`, errors)) {
    uniqueRecordIds(map.routes, `${root}.routes`, errors);
    map.routes.forEach((record, index) => {
      const path = `${root}.routes[${index}]`;
      const keys = ['id', 'kind', 'material', 'cells', 'required', 'width', 'featureId', 'visualAssets'];
      if (!exactObject(record, path, keys, errors)) return;
      safeId(record.id, `${path}.id`, errors);
      safeId(record.kind, `${path}.kind`, errors);
      safeId(record.material, `${path}.material`, errors);
      coordList(record.cells, `${path}.cells`, errors, dimensions, { min: 1 });
      boolean(record.required, `${path}.required`, errors);
      integer(record.width, `${path}.width`, errors, { min: 1 });
      safeId(record.featureId, `${path}.featureId`, errors);
      if (Array.isArray(record.cells)) record.cells.forEach((cell, cellIndex) => {
        if (map.playableMask?.[cell?.y]?.[cell?.x] !== true
          || map.terrain?.[cell?.y]?.[cell?.x]?.passable !== true) {
          push(errors, `${path}.cells[${cellIndex}]`, 'route cells must be playable and passable');
        }
      });
      if (array(record.visualAssets, `${path}.visualAssets`, errors, { min: 1 })) {
        const routeCells = new Set(record.cells?.map(coordKey));
        record.visualAssets.forEach((item, assetIndex) => {
          const assetPath = `${path}.visualAssets[${assetIndex}]`;
          if (!exactObject(item, assetPath, ['role', 'cells', 'asset'], errors)) return;
          safeId(item.role, `${assetPath}.role`, errors);
          coordList(item.cells, `${assetPath}.cells`, errors, dimensions, { min: 1 });
          item.cells?.forEach((cell, cellIndex) => {
            if (!routeCells.has(coordKey(cell))) {
              push(errors, `${assetPath}.cells[${cellIndex}]`, 'must belong to the route');
            }
          });
          assetRef(item.asset, `${assetPath}.asset`, errors, map.provenance?.assetBundle?.id);
        });
      }
    });
  }
}

function validateCapacities(value, path, errors) {
  if (!exactObject(value, path, ['playerCapacity', 'candidatePoolSize', 'maxAssignableOpponents'], errors)) return;
  integer(value.playerCapacity, `${path}.playerCapacity`, errors, { min: 1, max: 5 });
  integer(value.candidatePoolSize, `${path}.candidatePoolSize`, errors, { min: 1, max: 65536 });
  integer(value.maxAssignableOpponents, `${path}.maxAssignableOpponents`, errors, { min: 1, max: 64 });
  if (Number.isSafeInteger(value.maxAssignableOpponents)
    && Number.isSafeInteger(value.candidatePoolSize)
    && value.maxAssignableOpponents > value.candidatePoolSize) {
    push(errors, path, 'maxAssignableOpponents must not exceed candidatePoolSize');
  }
}

function validateSpawn(map, root, errors, dimensions) {
  const value = map.spawnContract;
  const path = `${root}.spawnContract`;
  const keys = [
    'capacities', 'formationFacing', 'playerSlots', 'opponentCandidates',
    'opponentZones', 'protectedClearances', 'exits', 'approachRegions',
    'minimumRouteConstraints', 'tacticalAnnotations'
  ];
  if (!exactObject(value, path, keys, errors)) return;
  validateCapacities(value.capacities, `${path}.capacities`, errors);
  if (exactObject(value.formationFacing, `${path}.formationFacing`, ['player', 'opponent'], errors)) {
    enumeration(value.formationFacing.player, `${path}.formationFacing.player`, BATTLE_MAP_V3_DIRECTIONS, errors);
    enumeration(value.formationFacing.opponent, `${path}.formationFacing.opponent`, BATTLE_MAP_V3_DIRECTIONS, errors);
  }
  const pointRecord = (record, itemPath, keysToUse) => {
    if (!exactObject(record, itemPath, keysToUse, errors)) return;
    safeId(record.id, `${itemPath}.id`, errors);
    coord(record.cell, `${itemPath}.cell`, errors, dimensions);
    uniqueStrings(record.tags, `${itemPath}.tags`, errors);
  };
  if (array(value.playerSlots, `${path}.playerSlots`, errors, { min: 1 })) {
    uniqueRecordIds(value.playerSlots, `${path}.playerSlots`, errors);
    value.playerSlots.forEach((record, index) => {
      const itemPath = `${path}.playerSlots[${index}]`;
      pointRecord(record, itemPath, ['id', 'cell', 'role', 'tags']);
      safeId(record?.role, `${itemPath}.role`, errors);
    });
  }
  if (array(value.opponentCandidates, `${path}.opponentCandidates`, errors)) {
    uniqueRecordIds(value.opponentCandidates, `${path}.opponentCandidates`, errors);
    value.opponentCandidates.forEach((record, index) => {
      const itemPath = `${path}.opponentCandidates[${index}]`;
      pointRecord(record, itemPath, ['id', 'cell', 'tags', 'zoneId', 'minimumClearance', 'tacticalAnnotationIds']);
      if (record && record.zoneId !== null) safeId(record.zoneId, `${itemPath}.zoneId`, errors);
      integer(record?.minimumClearance, `${itemPath}.minimumClearance`, errors, { min: 0, max: 32 });
      uniqueStrings(record?.tacticalAnnotationIds, `${itemPath}.tacticalAnnotationIds`, errors);
    });
  }
  if (array(value.opponentZones, `${path}.opponentZones`, errors)) {
    uniqueRecordIds(value.opponentZones, `${path}.opponentZones`, errors);
    value.opponentZones.forEach((record, index) => {
      const itemPath = `${path}.opponentZones[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'cells', 'tags', 'capacity'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      coordList(record.cells, `${itemPath}.cells`, errors, dimensions, { min: 1 });
      uniqueStrings(record.tags, `${itemPath}.tags`, errors);
      integer(record.capacity, `${itemPath}.capacity`, errors, { min: 1 });
    });
  }
  if (Array.isArray(value.opponentCandidates) && Array.isArray(value.opponentZones)
    && value.opponentCandidates.length === 0 && value.opponentZones.length === 0) {
    push(errors, path, 'must declare opponent candidate cells and/or zones');
  }
  if (array(value.protectedClearances, `${path}.protectedClearances`, errors)) {
    uniqueRecordIds(value.protectedClearances, `${path}.protectedClearances`, errors);
    value.protectedClearances.forEach((record, index) => {
      const itemPath = `${path}.protectedClearances[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'side', 'anchorId', 'radius'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      enumeration(record.side, `${itemPath}.side`, ['player', 'opponent'], errors);
      safeId(record.anchorId, `${itemPath}.anchorId`, errors);
      integer(record.radius, `${itemPath}.radius`, errors, { min: 0, max: 32 });
    });
  }
  if (array(value.approachRegions, `${path}.approachRegions`, errors, { min: 1 })) {
    uniqueRecordIds(value.approachRegions, `${path}.approachRegions`, errors);
    value.approachRegions.forEach((record, index) => {
      const itemPath = `${path}.approachRegions[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'side', 'cells'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      enumeration(record.side, `${itemPath}.side`, ['player', 'opponent'], errors);
      coordList(record.cells, `${itemPath}.cells`, errors, dimensions, { min: 1 });
    });
  }
  if (array(value.exits, `${path}.exits`, errors, { min: 1 })) {
    uniqueRecordIds(value.exits, `${path}.exits`, errors);
    value.exits.forEach((record, index) => {
      const itemPath = `${path}.exits[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'side', 'cell', 'approachRegionId'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      enumeration(record.side, `${itemPath}.side`, ['player', 'opponent'], errors);
      coord(record.cell, `${itemPath}.cell`, errors, dimensions);
      safeId(record.approachRegionId, `${itemPath}.approachRegionId`, errors);
    });
  }
  if (exactObject(value.minimumRouteConstraints, `${path}.minimumRouteConstraints`, [
    'minimumIndependentExits', 'requireMutualReachability', 'maximumTraversableElevationDelta'
  ], errors)) {
    integer(value.minimumRouteConstraints.minimumIndependentExits, `${path}.minimumRouteConstraints.minimumIndependentExits`, errors, { min: 1 });
    boolean(value.minimumRouteConstraints.requireMutualReachability, `${path}.minimumRouteConstraints.requireMutualReachability`, errors);
    integer(value.minimumRouteConstraints.maximumTraversableElevationDelta, `${path}.minimumRouteConstraints.maximumTraversableElevationDelta`, errors, { min: 0, max: 1 });
  }
  if (array(value.tacticalAnnotations, `${path}.tacticalAnnotations`, errors)) {
    uniqueRecordIds(value.tacticalAnnotations, `${path}.tacticalAnnotations`, errors);
    value.tacticalAnnotations.forEach((record, index) => {
      const itemPath = `${path}.tacticalAnnotations[${index}]`;
      if (!exactObject(record, itemPath, ['id', 'kind', 'cells', 'tags'], errors)) return;
      safeId(record.id, `${itemPath}.id`, errors);
      safeId(record.kind, `${itemPath}.kind`, errors);
      coordList(record.cells, `${itemPath}.cells`, errors, dimensions, { min: 1 });
      uniqueStrings(record.tags, `${itemPath}.tags`, errors);
    });
  }
  validateSpawnInvariants(map, root, errors);
}

function validateSpawnInvariants(map, root, errors) {
  const spawn = map.spawnContract;
  if (!spawn) return;
  const playerSlots = Array.isArray(spawn.playerSlots) ? spawn.playerSlots : [];
  const opponentCandidates = Array.isArray(spawn.opponentCandidates) ? spawn.opponentCandidates : [];
  const opponentZones = Array.isArray(spawn.opponentZones) ? spawn.opponentZones : [];
  const tacticalAnnotations = Array.isArray(spawn.tacticalAnnotations) ? spawn.tacticalAnnotations : [];
  const approachRegions = Array.isArray(spawn.approachRegions) ? spawn.approachRegions : [];
  const exits = Array.isArray(spawn.exits) ? spawn.exits : [];
  const protectedClearances = Array.isArray(spawn.protectedClearances) ? spawn.protectedClearances : [];
  const obstacles = Array.isArray(map.obstacles) ? map.obstacles : [];
  if (spawn.capacities?.playerCapacity !== playerSlots.length) {
    push(errors, `${root}.spawnContract.capacities.playerCapacity`, 'must equal playerSlots length');
  }
  const candidatePoolCells = new Set([
    ...opponentCandidates.map(record => coordKey(record?.cell)),
    ...opponentZones.flatMap(zone => Array.isArray(zone?.cells) ? zone.cells.map(coordKey) : [])
  ]);
  if (spawn.capacities?.candidatePoolSize !== candidatePoolCells.size) {
    push(errors, `${root}.spawnContract.capacities.candidatePoolSize`, 'must equal the unique candidate-cell and zone-cell pool size');
  }
  const zoneIds = new Set(opponentZones.map(zone => zone?.id));
  const zoneCells = new Map(opponentZones.map(zone => [
    zone?.id,
    new Set(Array.isArray(zone?.cells) ? zone.cells.map(coordKey) : [])
  ]));
  const annotationIds = new Set(tacticalAnnotations.map(annotation => annotation?.id));
  const approachIds = new Set(approachRegions.map(region => region?.id));
  const approachesById = new Map(approachRegions.map(region => [region?.id, region]));
  const anchorIds = new Set([
    ...playerSlots.map(slot => slot?.id),
    ...opponentCandidates.map(candidate => candidate?.id)
  ]);
  const anchorSides = new Map([
    ...playerSlots.map(slot => [slot?.id, 'player']),
    ...opponentCandidates.map(candidate => [candidate?.id, 'opponent'])
  ]);
  const obstacleCells = new Set(
    obstacles.filter(obstacle => obstacle?.blocking)
      .flatMap(obstacle => Array.isArray(obstacle?.cells) ? obstacle.cells.map(coordKey) : [])
  );
  const occupied = new Set();
  const checkSpawnCell = (record, path) => {
    const key = coordKey(record?.cell);
    if (occupied.has(key)) push(errors, `${path}.cell`, `duplicate spawn coordinate ${key}`);
    occupied.add(key);
    const { x, y } = record?.cell ?? {};
    if (map.playableMask?.[y]?.[x] !== true || map.terrain?.[y]?.[x]?.passable !== true) {
      push(errors, `${path}.cell`, 'must be playable and passable');
    }
    if (obstacleCells.has(key)) push(errors, `${path}.cell`, 'must not contain a blocking obstacle');
  };
  playerSlots.forEach((record, index) => checkSpawnCell(record, `${root}.spawnContract.playerSlots[${index}]`));
  opponentCandidates.forEach((record, index) => {
    const path = `${root}.spawnContract.opponentCandidates[${index}]`;
    checkSpawnCell(record, path);
    if (record?.zoneId !== null && !zoneIds.has(record?.zoneId)) {
      push(errors, `${path}.zoneId`, `unknown opponent zone id ${record?.zoneId}`);
    } else if (record?.zoneId !== null && !zoneCells.get(record?.zoneId)?.has(coordKey(record?.cell))) {
      push(errors, `${path}.cell`, `must belong to opponent zone ${record?.zoneId}`);
    }
    if (Array.isArray(record?.tacticalAnnotationIds)) record.tacticalAnnotationIds.forEach((id, annotationIndex) => {
      if (!annotationIds.has(id)) push(errors, `${path}.tacticalAnnotationIds[${annotationIndex}]`, `unknown tactical annotation id ${id}`);
    });
  });
  exits.forEach((record, index) => {
    const path = `${root}.spawnContract.exits[${index}]`;
    if (!approachIds.has(record?.approachRegionId)) {
      push(errors, `${path}.approachRegionId`, `unknown approach region id ${record?.approachRegionId}`);
    }
    const { x, y } = record?.cell ?? {};
    if (map.playableMask?.[y]?.[x] !== true || map.terrain?.[y]?.[x]?.passable !== true) {
      push(errors, `${path}.cell`, 'must be playable and passable');
    }
    const approach = approachesById.get(record?.approachRegionId);
    if (approach && approach.side !== record?.side) {
      push(errors, `${path}.approachRegionId`, 'referenced approach region must belong to the same side');
    }
    if (approach && (!Array.isArray(approach.cells)
      || !approach.cells.some(cell => coordKey(cell) === coordKey(record?.cell)))) {
      push(errors, `${path}.cell`, 'must belong to the referenced approach region');
    }
  });
  protectedClearances.forEach((record, index) => {
    if (!anchorIds.has(record?.anchorId)) {
      push(errors, `${root}.spawnContract.protectedClearances[${index}].anchorId`, `unknown spawn anchor id ${record?.anchorId}`);
    } else if (anchorSides.get(record?.anchorId) !== record?.side) {
      push(errors, `${root}.spawnContract.protectedClearances[${index}].side`, 'must match the referenced spawn anchor side');
    }
  });
  opponentZones.forEach((zone, index) => {
    if (Number.isSafeInteger(zone?.capacity) && Array.isArray(zone?.cells)
      && zone.capacity > zone.cells.length) {
      push(errors, `${root}.spawnContract.opponentZones[${index}].capacity`, 'must not exceed zone cell count');
    }
    if (Array.isArray(zone?.cells)) zone.cells.forEach((cell, cellIndex) => {
      const path = `${root}.spawnContract.opponentZones[${index}].cells[${cellIndex}]`;
      const key = coordKey(cell);
      const { x, y } = cell ?? {};
      if (map.playableMask?.[y]?.[x] !== true || map.terrain?.[y]?.[x]?.passable !== true) {
        push(errors, path, 'must be playable and passable');
      }
      if (obstacleCells.has(key)) push(errors, path, 'must not contain a blocking obstacle');
      if (playerSlots.some(slot => coordKey(slot?.cell) === key)) {
        push(errors, path, 'must not overlap a player formation slot');
      }
    });
  });
  const requiredExits = spawn.minimumRouteConstraints?.minimumIndependentExits;
  if (Number.isSafeInteger(requiredExits)) {
    for (const side of ['player', 'opponent']) {
      const sideExitCount = exits.filter(exit => exit?.side === side).length;
      if (sideExitCount < requiredExits) {
        push(errors, `${root}.spawnContract.minimumRouteConstraints.minimumIndependentExits`, `${side} side has only ${sideExitCount} exits`);
      }
    }
  }
}

function validateReferences(map, root, errors) {
  const features = Array.isArray(map.features) ? map.features : [];
  const featureIds = new Set(features.map(feature => feature?.id));
  const check = (id, path) => {
    // Void terrain cells are represented by null and therefore have no
    // featureId. Structural validation separately requires featureId on every
    // non-null terrain record.
    if (id !== null && id !== undefined && !featureIds.has(id)) {
      push(errors, path, `unknown feature id ${id}`);
    }
  };
  if (Array.isArray(map.terrain)) {
    map.terrain.forEach((row, y) => {
      if (Array.isArray(row)) row.forEach((cell, x) => check(cell?.featureId, `${root}.terrain[${y}][${x}].featureId`));
    });
  }
  for (const collection of ['elevationConnections', 'obstacles', 'decorations', 'boundaries', 'routes']) {
    if (Array.isArray(map[collection])) {
      map[collection].forEach((record, index) => check(record?.featureId, `${root}.${collection}[${index}].featureId`));
    }
  }
}

function validateMap(value, final) {
  const errors = [];
  const root = final ? 'BattleMapV3Final' : 'BattleMapV3Candidate';
  const expectedKeys = [
    ...MAP_KEYS,
    ...OPTIONAL_MAP_KEYS.filter(key => Object.hasOwn(value ?? {}, key)),
    ...(final ? ['hashes'] : [])
  ];
  if (!exactObject(value, root, expectedKeys, errors)) return { valid: false, errors };
  if (value.battleMapSchemaVersion !== BATTLE_MAP_V3_SCHEMA_VERSION) push(errors, `${root}.battleMapSchemaVersion`, 'must equal 3');
  if (value.terrainGenerationVersion !== BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION) push(errors, `${root}.terrainGenerationVersion`, 'must equal 3');
  safeId(value.contentId, `${root}.contentId`, errors);
  integer(value.contentVersion, `${root}.contentVersion`, errors, { min: 1 });
  safeId(value.templateId, `${root}.templateId`, errors);
  integer(value.templateRevision, `${root}.templateRevision`, errors, { min: 1 });
  safeId(value.theme, `${root}.theme`, errors);
  safeId(value.renderProfileId, `${root}.renderProfileId`, errors);
  if (Object.hasOwn(value, 'ecologyProfile')) {
    safeId(value.ecologyProfile, `${root}.ecologyProfile`, errors);
  }
  if (Object.hasOwn(value, 'scene')) {
    validateScene(value.scene, `${root}.scene`, errors);
  }
  uniqueStrings(value.tierEligibility, `${root}.tierEligibility`, errors, { min: 1 });
  uniqueStrings(value.supportedModes, `${root}.supportedModes`, errors, { min: 1 });
  if (exactObject(value.dimensions, `${root}.dimensions`, ['width', 'height'], errors)) {
    integer(value.dimensions.width, `${root}.dimensions.width`, errors, { min: 1, max: BATTLE_MAP_V3_MAX_DIMENSION });
    integer(value.dimensions.height, `${root}.dimensions.height`, errors, { min: 1, max: BATTLE_MAP_V3_MAX_DIMENSION });
  }
  const dimensions = {
    width: Number.isSafeInteger(value.dimensions?.width) && value.dimensions.width > 0 ? value.dimensions.width : 1,
    height: Number.isSafeInteger(value.dimensions?.height) && value.dimensions.height > 0 ? value.dimensions.height : 1
  };
  validateProvenance(value.provenance, `${root}.provenance`, errors);
  validateLayers(value, root, errors, dimensions);
  validateConnections(value, root, errors, dimensions);
  validateObjects(value, root, errors, dimensions);
  validateFeaturesAndRoutes(value, root, errors, dimensions);
  validateSpawn(value, root, errors, dimensions);
  if (value.hashVersion !== BATTLE_MAP_V3_HASH_VERSION) push(errors, `${root}.hashVersion`, `must equal ${BATTLE_MAP_V3_HASH_VERSION}`);
  if (final && exactObject(value.hashes, `${root}.hashes`, ['authoritativeHash', 'visualHash', 'fullHash'], errors)) {
    sha256(value.hashes.authoritativeHash, `${root}.hashes.authoritativeHash`, errors);
    sha256(value.hashes.visualHash, `${root}.hashes.visualHash`, errors);
    sha256(value.hashes.fullHash, `${root}.hashes.fullHash`, errors);
  }
  validateReferences(value, root, errors);
  return { valid: errors.length === 0, errors };
}

export function validateBattleMapV3Candidate(value) {
  return validateMap(value, false);
}

export function validateBattleMapV3Final(value) {
  return validateMap(value, true);
}

export function assertBattleMapV3Candidate(value) {
  assertion(validateBattleMapV3Candidate(value), 'BattleMapV3Candidate', 'INVALID_BATTLE_MAP_V3');
  return value;
}

export function assertBattleMapV3Final(value) {
  assertion(validateBattleMapV3Final(value), 'BattleMapV3Final', 'INVALID_BATTLE_MAP_V3');
  return value;
}

export const BattleMapV3RecordShapes = Object.freeze({
  candidate: [...MAP_KEYS, ...OPTIONAL_MAP_KEYS],
  final: FINAL_MAP_KEYS,
  dimensions: ['width', 'height'],
  assetRef: ['assetBundleId', 'key', 'contentVersion', 'contentHash', 'immutableUrl'],
  capacities: ['playerCapacity', 'candidatePoolSize', 'maxAssignableOpponents'],
  hashes: ['authoritativeHash', 'visualHash', 'fullHash']
});
