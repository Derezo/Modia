import { deepFreeze } from './V2Context.js';

const MACRO_GRID_SIZE = 4;
const INVALID_MATERIAL = '\u0000invalid-material';
const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 })
]);
const EDGE_OUTLET_KINDS = new Set([
  'stream',
  'drainage',
  'river',
  'lava'
]);

export const ORGANIC_QUALITY_THRESHOLDS = deepFreeze({
  maximumMaterialDominance: 0.80,
  maximumUniformRectangleRatio: 0.50,
  minimumRouteTurnDensity: 0.05,
  minimumDecorationDensity: 0.15,
  minimumDecorationMacroCoverage: 10
});

const RECIPE_QUALITY_OVERRIDES = deepFreeze({
  plains: {
    // Open grassland should preserve broad sight lines. Requiring the same
    // material mix as a forest or wetland turns plains into visual clutter.
    maximumMaterialDominance: 0.92
  },
  swamp: {
    // Retained basins can leave one legal direct route between protected
    // staging areas. Wetland identity is enforced by the recipe-specific
    // hydrology and blocking-ecology checks instead of artificial route bends.
    minimumRouteTurnDensity: 0
  }
});

const MINIMUM_ROUTE_TURN_OPPORTUNITIES = 4;
const MINIMUM_COMPACT_MACRO_COVERAGE = 4;

function dimensionsOf(map) {
  const terrain = Array.isArray(map?.terrain) ? map.terrain : [];
  const inferredHeight = terrain.length;
  const inferredWidth = terrain.reduce(
    (maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0),
    0
  );
  const width = Number.isInteger(map?.mapWidth) && map.mapWidth > 0
    ? map.mapWidth
    : inferredWidth;
  const height = Number.isInteger(map?.mapHeight) && map.mapHeight > 0
    ? map.mapHeight
    : inferredHeight;
  return { width, height };
}

function materialAt(map, x, y) {
  const cell = map?.terrain?.[y]?.[x];
  return typeof cell?.material === 'string' && cell.material.length > 0
    ? cell.material
    : INVALID_MATERIAL;
}

function coordinateKey(point) {
  return `${point.x},${point.y}`;
}

function validPoint(point, width, height) {
  return Number.isInteger(point?.x) &&
    Number.isInteger(point?.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < width &&
    point.y < height;
}

function waterBodiesOf(map) {
  const bodies = map?.features?.waterBodies ??
    map?.hydrology?.waterBodies ??
    map?.waterBodies;
  return Array.isArray(bodies) ? bodies : [];
}

function routesOf(map) {
  const routes = map?.features?.routes ??
    map?.routePlan?.features ??
    map?.routes;
  return Array.isArray(routes) ? routes : [];
}

function decorationsOf(map) {
  return Array.isArray(map?.decorations) ? map.decorations : [];
}

function obstaclesOf(map) {
  return Array.isArray(map?.obstacles) ? map.obstacles : [];
}

function dimensionProfile(width, height) {
  const shorter = Math.min(width, height);
  const area = width * height;
  if (shorter < 14 || area < 196) return 'compact';
  if (shorter <= 32 || area <= 1024) return 'standard';
  return 'large';
}

/**
 * Resolve conservative pre-gallery guardrails. The defaults deliberately
 * remain exported as the standard-size natural profile; compact maps scale
 * only the spatial-coverage requirement, and recipe exceptions are explicit.
 */
export function resolveOrganicQualityThresholds(map, recipe, metrics = null) {
  const measured = metrics ?? measureOrganicQuality(map, recipe);
  const recipeOverrides = RECIPE_QUALITY_OVERRIDES[recipe?.nodeType] ?? {};
  const profile = dimensionProfile(measured.width, measured.height);
  const minimumDecorationMacroCoverage = Math.min(
    ORGANIC_QUALITY_THRESHOLDS.minimumDecorationMacroCoverage,
    Math.max(
      MINIMUM_COMPACT_MACRO_COVERAGE,
      Math.floor(measured.area / 40)
    )
  );
  const minimumHydrologyCoverage =
    recipe?.quality?.minimumHydrologyCoverageByProfile?.[profile] ?? 0;
  const minimumBlockingObstacleCount =
    recipe?.quality?.minimumBlockingObstacleCountByProfile?.[profile] ?? 0;
  return deepFreeze({
    ...ORGANIC_QUALITY_THRESHOLDS,
    ...recipeOverrides,
    minimumRouteTurnDensity:
      measured.routeTurnOpportunityCount >= MINIMUM_ROUTE_TURN_OPPORTUNITIES
        ? (recipeOverrides.minimumRouteTurnDensity
          ?? ORGANIC_QUALITY_THRESHOLDS.minimumRouteTurnDensity)
        : 0,
    minimumDecorationMacroCoverage,
    ...(minimumHydrologyCoverage > 0
      ? { minimumHydrologyCoverage }
      : {}),
    ...(minimumBlockingObstacleCount > 0
      ? { minimumBlockingObstacleCount }
      : {})
  });
}

function hydrologySemantics(recipe) {
  const kind = recipe?.hydrology?.kind ?? recipe?.waterKind ?? 'none';
  const material = recipe?.hydrology?.material ??
    (kind === 'lava' ? 'lava' : 'water');
  return { kind, material };
}

/**
 * Find the largest same-material axis-aligned rectangle. The histogram is
 * evaluated independently for each contiguous material run in every row, so
 * adjacent bars belonging to different materials can never be combined.
 */
function largestUniformRectangleArea(map, width, height) {
  if (width === 0 || height === 0) return 0;
  const heights = Array.from({ length: width }, () => 0);
  const priorMaterials = Array.from({ length: width }, () => null);
  let maximumArea = 0;

  for (let y = 0; y < height; y++) {
    const materials = Array.from(
      { length: width },
      (_, x) => materialAt(map, x, y)
    );
    for (let x = 0; x < width; x++) {
      heights[x] = priorMaterials[x] === materials[x]
        ? heights[x] + 1
        : 1;
      priorMaterials[x] = materials[x];
    }

    let runStart = 0;
    while (runStart < width) {
      let runEnd = runStart + 1;
      while (runEnd < width && materials[runEnd] === materials[runStart]) {
        runEnd++;
      }
      const stack = [];
      for (let x = runStart; x <= runEnd; x++) {
        const currentHeight = x === runEnd ? 0 : heights[x];
        while (
          stack.length > 0 &&
          heights[stack[stack.length - 1]] > currentHeight
        ) {
          const bar = stack.pop();
          const left = stack.length > 0
            ? stack[stack.length - 1] + 1
            : runStart;
          maximumArea = Math.max(
            maximumArea,
            heights[bar] * (x - left)
          );
        }
        if (x < runEnd) stack.push(x);
      }
      runStart = runEnd;
    }
  }
  return maximumArea;
}

function routeTurnMetrics(map) {
  let turns = 0;
  let opportunities = 0;
  for (const route of routesOf(map)) {
    const centerline = Array.isArray(route?.centerline)
      ? route.centerline
      : [];
    for (let index = 1; index + 1 < centerline.length; index++) {
      const before = centerline[index - 1];
      const current = centerline[index];
      const after = centerline[index + 1];
      if (![before, current, after].every(point =>
        Number.isInteger(point?.x) && Number.isInteger(point?.y)
      )) continue;
      const incoming = {
        x: Math.sign(current.x - before.x),
        y: Math.sign(current.y - before.y)
      };
      const outgoing = {
        x: Math.sign(after.x - current.x),
        y: Math.sign(after.y - current.y)
      };
      if (
        (incoming.x === 0 && incoming.y === 0) ||
        (outgoing.x === 0 && outgoing.y === 0)
      ) continue;
      opportunities++;
      if (incoming.x !== outgoing.x || incoming.y !== outgoing.y) turns++;
    }
  }
  return {
    routeTurnCount: turns,
    routeTurnOpportunityCount: opportunities,
    routeTurnDensity: opportunities === 0 ? 0 : turns / opportunities
  };
}

function decorationMetrics(map, width, height, area) {
  const occupiedCells = new Set();
  const occupiedMacroCells = new Set();
  for (const decoration of decorationsOf(map)) {
    if (!validPoint(decoration, width, height)) continue;
    const key = coordinateKey(decoration);
    if (occupiedCells.has(key)) continue;
    occupiedCells.add(key);
    const macroX = Math.min(
      MACRO_GRID_SIZE - 1,
      Math.floor(decoration.x * MACRO_GRID_SIZE / width)
    );
    const macroY = Math.min(
      MACRO_GRID_SIZE - 1,
      Math.floor(decoration.y * MACRO_GRID_SIZE / height)
    );
    occupiedMacroCells.add(`${macroX},${macroY}`);
  }
  return {
    decorationCount: occupiedCells.size,
    decorationDensity: area === 0 ? 0 : occupiedCells.size / area,
    decorationMacroCoverage: occupiedMacroCells.size
  };
}

function recipeIdentityMetrics(map, width, height, area) {
  const waterCells = new Set();
  for (const body of waterBodiesOf(map)) {
    for (const cell of body?.cells ?? []) {
      if (validPoint(cell, width, height)) waterCells.add(coordinateKey(cell));
    }
  }
  const blockingObstacleCells = new Set();
  for (const obstacle of obstaclesOf(map)) {
    if (obstacle?.blocking !== true || !validPoint(obstacle, width, height)) continue;
    blockingObstacleCells.add(coordinateKey(obstacle));
  }
  return {
    hydrologyCoverage: area === 0 ? 0 : waterCells.size / area,
    blockingObstacleCount: blockingObstacleCells.size,
    blockingObstacleDensity: area === 0
      ? 0
      : blockingObstacleCells.size / area
  };
}

export function measureOrganicQuality(map, recipe) {
  const { width, height } = dimensionsOf(map);
  const area = width * height;
  const materialCounts = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const material = materialAt(map, x, y);
      materialCounts.set(material, (materialCounts.get(material) ?? 0) + 1);
    }
  }
  const rankedMaterials = [...materialCounts.entries()].sort(
    (left, right) => right[1] - left[1] ||
      left[0].localeCompare(right[0])
  );
  const dominantMaterial = rankedMaterials[0]?.[0] ?? null;
  const dominantMaterialCount = rankedMaterials[0]?.[1] ?? 0;
  const rectangleArea = largestUniformRectangleArea(map, width, height);
  return deepFreeze({
    width,
    height,
    area,
    family: recipe?.family ?? null,
    dominantMaterial: dominantMaterial === INVALID_MATERIAL
      ? null
      : dominantMaterial,
    dominantMaterialCount,
    materialDominance: area === 0 ? 1 : dominantMaterialCount / area,
    largestUniformRectangleArea: rectangleArea,
    largestUniformRectangleRatio: area === 0 ? 1 : rectangleArea / area,
    ...routeTurnMetrics(map),
    ...decorationMetrics(map, width, height, area),
    ...recipeIdentityMetrics(map, width, height, area)
  });
}

function isEdge(point, width, height) {
  return point.x === 0 ||
    point.y === 0 ||
    point.x === width - 1 ||
    point.y === height - 1;
}

function bodyIsFourConnected(cellKeys, width, height) {
  if (cellKeys.size === 0) return false;
  const first = cellKeys.values().next().value;
  const queue = [first];
  const visited = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [x, y] = queue[cursor].split(',').map(Number);
    for (const offset of CARDINAL_OFFSETS) {
      const neighbor = `${x + offset.x},${y + offset.y}`;
      if (!cellKeys.has(neighbor) || visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return visited.size === cellKeys.size;
}

function controlledRouteOverlayMaterials(map, width, height) {
  const materialsByCell = new Map();
  for (const route of routesOf(map)) {
    if (typeof route?.material !== 'string' || route.material.length === 0) {
      continue;
    }
    const centerline = Array.isArray(route.centerline)
      ? route.centerline
      : [];
    const nominalWidth = Number.isFinite(route.width)
      ? Math.max(1, Math.round(route.width))
      : 1;
    // Route masks may vary by one tile around their nominal width and publish
    // a one-tile shoulder. This radius is the closed upper bound of that
    // footprint, not a blanket exemption for arbitrary terrain replacement.
    const maximumOverlayRadius = Math.ceil(nominalWidth / 2) + 1;
    for (const point of centerline) {
      if (!validPoint(point, width, height)) continue;
      for (let dy = -maximumOverlayRadius; dy <= maximumOverlayRadius; dy++) {
        const remaining = maximumOverlayRadius - Math.abs(dy);
        for (let dx = -remaining; dx <= remaining; dx++) {
          const candidate = { x: point.x + dx, y: point.y + dy };
          if (!validPoint(candidate, width, height)) continue;
          const key = coordinateKey(candidate);
          if (!materialsByCell.has(key)) materialsByCell.set(key, new Set());
          materialsByCell.get(key).add(route.material);
        }
      }
    }
  }
  return materialsByCell;
}

/**
 * Validate only final hydrology semantics. Issue codes are de-duplicated and
 * sorted so diagnostics do not depend on body or cell scan order.
 */
export function validateHydrologyIntegrity(map, recipe) {
  const { width, height } = dimensionsOf(map);
  const { kind, material } = hydrologySemantics(recipe);
  const bodies = waterBodiesOf(map);
  const issues = new Set();
  let bodyCellCount = 0;
  let overlaidBodyCellCount = 0;
  const globallyOwnedCells = new Set();
  const routeOverlayMaterials = controlledRouteOverlayMaterials(
    map,
    width,
    height
  );

  if (width <= 0 || height <= 0) issues.add('dimensions-invalid');
  if (kind === 'none' && bodies.length > 0) {
    issues.add('bodies-unexpected-for-none');
  }

  for (const body of bodies) {
    if (!body || typeof body !== 'object') {
      issues.add('body-invalid');
      continue;
    }
    if (body.kind !== kind) issues.add('body-kind-mismatch');
    if (body.material !== material) issues.add('body-material-mismatch');
    if (!Array.isArray(body.cells) || body.cells.length === 0) {
      issues.add('body-cells-invalid');
      continue;
    }

    const bodyCellKeys = new Set();
    for (const cell of body.cells) {
      if (!validPoint(cell, width, height)) {
        issues.add('body-cell-out-of-bounds');
        continue;
      }
      const key = coordinateKey(cell);
      if (bodyCellKeys.has(key)) issues.add('body-cell-duplicate');
      if (globallyOwnedCells.has(key)) issues.add('body-cell-multiply-owned');
      bodyCellKeys.add(key);
      const terrainMaterial = materialAt(map, cell.x, cell.y);
      if (terrainMaterial !== material) {
        if (routeOverlayMaterials.get(key)?.has(terrainMaterial)) {
          overlaidBodyCellCount++;
        } else {
          issues.add('terrain-material-mismatch');
        }
      }
    }
    for (const key of bodyCellKeys) globallyOwnedCells.add(key);
    bodyCellCount += bodyCellKeys.size;
    if (!bodyIsFourConnected(bodyCellKeys, width, height)) {
      issues.add('body-not-four-connected');
    }

    if (!Array.isArray(body.sourceCells) || body.sourceCells.length === 0) {
      issues.add('source-cells-invalid');
    } else {
      for (const source of body.sourceCells) {
        if (
          !validPoint(source, width, height) ||
          !bodyCellKeys.has(coordinateKey(source))
        ) {
          issues.add('source-not-in-body');
        }
      }
    }

    const outlet = body.outletCell;
    if (outlet !== null && outlet !== undefined) {
      if (
        !validPoint(outlet, width, height) ||
        !bodyCellKeys.has(coordinateKey(outlet))
      ) {
        issues.add('outlet-not-in-body');
      } else if (EDGE_OUTLET_KINDS.has(kind) &&
                 !isEdge(outlet, width, height)) {
        issues.add('outlet-not-on-edge');
      }
    } else if (EDGE_OUTLET_KINDS.has(kind)) {
      issues.add('outlet-required');
    }
  }

  const sortedIssues = [...issues].sort();
  return deepFreeze({
    valid: sortedIssues.length === 0,
    kind,
    material,
    bodyCount: bodies.length,
    bodyCellCount,
    overlaidBodyCellCount,
    issues: sortedIssues
  });
}

function check(id, pass, value, target, message) {
  return Object.freeze({ id, pass, value, target, message });
}

function organicCheck(isNatural, id, pass, value, target, message) {
  return isNatural
    ? check(id, pass, value, target, message)
    : check(
        id,
        true,
        'skipped',
        'natural-family-only',
        'Skipped because organic geometry gates apply only to natural recipes.'
      );
}

export function evaluateOrganicQuality(map, recipe) {
  const metrics = measureOrganicQuality(map, recipe);
  const hydrology = validateHydrologyIntegrity(map, recipe);
  const thresholds = resolveOrganicQualityThresholds(map, recipe, metrics);
  const isNatural = recipe?.family === 'natural';
  const recipeIdentityChecks = [];
  if ((thresholds.minimumHydrologyCoverage ?? 0) > 0) {
    recipeIdentityChecks.push(check(
      'organic.recipe-hydrology-coverage',
      metrics.hydrologyCoverage >= thresholds.minimumHydrologyCoverage / 1_000_000,
      metrics.hydrologyCoverage,
      thresholds.minimumHydrologyCoverage / 1_000_000,
      'Recipe-specific hydrology must cover enough of the final map.'
    ));
  }
  if ((thresholds.minimumBlockingObstacleCount ?? 0) > 0) {
    recipeIdentityChecks.push(check(
      'organic.recipe-blocking-ecology',
      metrics.blockingObstacleCount >= thresholds.minimumBlockingObstacleCount,
      metrics.blockingObstacleCount,
      thresholds.minimumBlockingObstacleCount,
      'Recipe-specific blocking ecology must remain visibly represented.'
    ));
  }
  const checks = [
    organicCheck(
      isNatural,
      'organic.material-dominance',
      metrics.materialDominance <= thresholds.maximumMaterialDominance,
      metrics.materialDominance,
      thresholds.maximumMaterialDominance,
      'Dominant terrain material must not overwhelm a natural map.'
    ),
    organicCheck(
      isNatural,
      'organic.uniform-rectangle',
      metrics.largestUniformRectangleRatio <=
        thresholds.maximumUniformRectangleRatio,
      metrics.largestUniformRectangleRatio,
      thresholds.maximumUniformRectangleRatio,
      'Largest uniform axis-aligned terrain rectangle must remain bounded.'
    ),
    organicCheck(
      isNatural,
      'organic.route-turn-density',
      metrics.routeTurnDensity >= thresholds.minimumRouteTurnDensity,
      metrics.routeTurnDensity,
      thresholds.minimumRouteTurnDensity,
      'Natural route centerlines must include enough directional changes.'
    ),
    organicCheck(
      isNatural,
      'organic.decoration-density',
      metrics.decorationDensity >= thresholds.minimumDecorationDensity,
      metrics.decorationDensity,
      thresholds.minimumDecorationDensity,
      'Natural maps must contain enough occupied decoration cells.'
    ),
    organicCheck(
      isNatural,
      'organic.decoration-macro-coverage',
      metrics.decorationMacroCoverage >=
        thresholds.minimumDecorationMacroCoverage,
      metrics.decorationMacroCoverage,
      thresholds.minimumDecorationMacroCoverage,
      'Natural-map decorations must cover enough cells of the 4x4 macro grid.'
    ),
    check(
      'organic.hydrology-integrity',
      hydrology.valid,
      hydrology.valid,
      true,
      'Published hydrology bodies must match final recipe and terrain semantics.'
    ),
    ...recipeIdentityChecks
  ];
  const details = checks.map(record => Object.freeze({
    id: record.id,
    passed: record.pass,
    actual: record.value,
    threshold: record.target
  }));
  return deepFreeze({
    pass: checks.every(record => record.pass),
    metrics,
    hydrology,
    checks,
    details
  });
}
