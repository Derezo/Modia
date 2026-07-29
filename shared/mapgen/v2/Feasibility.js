import { deepFreeze } from './V2Context.js';
import { getV2Recipe } from './RecipeRegistry.js';

export class V2FeasibilityError extends RangeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'V2FeasibilityError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function dimensionProfile(width, height) {
  const shorter = Math.min(width, height);
  const area = width * height;
  if (shorter < 14 || area < 196) return 'compact';
  if (shorter <= 32 || area <= 1024) return 'standard';
  return 'large';
}

function scaledBudget(area, divisor, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.floor(area / divisor)));
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new V2FeasibilityError(
      'INVALID_REQUEST',
      `${name} must be a positive integer`,
      { field: name, value }
    );
  }
}

/**
 * Resolve size/mode/capacity budgets before an attempt seed is consumed.
 */
export function compileFeasibilityProfile(request, { capabilityCatalog = null } = {}) {
  const {
    nodeType,
    mapWidth,
    mapHeight,
    mode = 'pve',
    playerCount = 5,
    enemyCapacity = Math.max(6, playerCount)
  } = request ?? {};
  const recipe = getV2Recipe(nodeType);
  requirePositiveInteger(mapWidth, 'mapWidth');
  requirePositiveInteger(mapHeight, 'mapHeight');
  requirePositiveInteger(playerCount, 'playerCount');
  requirePositiveInteger(enemyCapacity, 'enemyCapacity');

  const bounds = recipe.supportedDimensions;
  if (mapWidth < bounds.minimumWidth || mapHeight < bounds.minimumHeight ||
      mapWidth > bounds.maximumWidth || mapHeight > bounds.maximumHeight) {
    throw new V2FeasibilityError(
      'UNSUPPORTED_DIMENSIONS',
      `${nodeType} does not support ${mapWidth}x${mapHeight}`,
      { nodeType, mapWidth, mapHeight, supportedDimensions: bounds }
    );
  }
  if (!recipe.supportedModes.includes(mode)) {
    throw new V2FeasibilityError(
      'UNSUPPORTED_MODE',
      `${nodeType} does not support battle mode ${mode}`,
      { nodeType, mode, supportedModes: recipe.supportedModes }
    );
  }
  if (playerCount > 5 || enemyCapacity > 24) {
    throw new V2FeasibilityError(
      'UNSUPPORTED_CAPACITY',
      'V2 formation capacity exceeds the supported battle contract',
      { playerCount, enemyCapacity, maximumPlayers: 5, maximumEnemies: 24 }
    );
  }

  const area = mapWidth * mapHeight;
  const profile = dimensionProfile(mapWidth, mapHeight);
  const optionalWater = recipe.hydrology.enabled && profile !== 'compact';
  const requiredWater = recipe.waterKind === 'river' || recipe.waterKind === 'lava';

  const requiredCapabilityKeys = [
    ...recipe.renderRequirements.floors,
    ...recipe.renderRequirements.exposedFaces,
    ...recipe.renderRequirements.connections,
    ...recipe.renderRequirements.transitions,
    ...recipe.renderRequirements.obstacles,
    ...recipe.renderRequirements.decorations
  ];
  const missingCapabilityKeys = capabilityCatalog
    ? requiredCapabilityKeys.filter(key => !capabilityCatalog.has(key))
    : [];
  if (capabilityCatalog && missingCapabilityKeys.length > 0) {
    throw new V2FeasibilityError(
      'MISSING_RENDER_CAPABILITY',
      `${nodeType} render palette is incomplete`,
      { nodeType, palette: recipe.renderPalette, missingCapabilityKeys }
    );
  }
  const sourceCount = optionalWater || requiredWater
    ? recipe.hydrology.sourceCountByProfile[profile]
    : 0;
  const minimumContributingArea = Math.max(
    4,
    Math.min(
      Math.floor(area / 4),
      Math.round(
        recipe.hydrology.minimumContributingArea *
        (profile === 'compact' ? 0.5 : profile === 'large' ? 1.5 : 1)
      )
    )
  );
  const retainedBasins = recipe.hydrology.basinPolicy === 'retain-ranked-basins';
  const scaledWaterBodyCount = recipe.hydrology.enabled
    ? scaledBudget(area, profile === 'compact' ? 600 : 420, 0, 6)
    : 0;
  const waterBodyCount = retainedBasins && sourceCount > 0
    ? Math.max(1, scaledWaterBodyCount)
    : scaledWaterBodyCount;

  return deepFreeze({
    profileVersion: 'battle-map-v2-feasibility-v1',
    nodeType,
    mode,
    dimensions: { width: mapWidth, height: mapHeight, area, profile },
    capacity: { playerCount, enemyCapacity },
    requiredFeatures: [
      { kind: 'route-network', minimumFootprint: Math.max(8, mapWidth - 4) },
      ...(requiredWater
        ? [{ kind: recipe.waterKind, minimumFootprint: Math.max(10, mapHeight - 2) }]
        : [])
    ],
    optionalFeatures: [
      ...(optionalWater
        ? [{ kind: recipe.waterKind, budget: scaledBudget(area, 320, 1, 4) }]
        : []),
      { kind: 'clearing', budget: scaledBudget(area, 280, 1, 5) },
      {
        kind: 'decoration-cluster',
        budget: scaledBudget(area, profile === 'compact' ? 90 : 65, 1, 32)
      }
    ],
    budgets: {
      maximumAttempts: profile === 'compact' ? 4 : 6,
      regionCount: scaledBudget(area, profile === 'compact' ? 72 : 96, 3, 24),
      waterBodyCount,
      routeCount: recipe.family === 'arena' ? 3 : 2,
      clearingCount: scaledBudget(area, 300, 1, 5),
      blockingPropCount: Math.floor(area * recipe.ecology.blockingDensity / 1_000_000),
      decorationCount: Math.floor(area * recipe.ecology.decorationDensity / 1_000_000)
    },
    hydrology: {
      enabled: sourceCount > 0,
      kind: recipe.hydrology.kind,
      material: recipe.hydrology.material,
      sourceCount,
      minimumContributingArea,
      maximumChannelWidth: recipe.hydrology.maximumChannelWidthByProfile[profile],
      retainedBasinArea: recipe.hydrology.retainedBasinAreaByProfile[profile],
      maximumCoverage: recipe.hydrology.maximumCoverage,
      wetnessRadius: recipe.hydrology.wetnessRadiusByProfile[profile],
      outletPolicy: recipe.hydrology.outletPolicy,
      basinPolicy: recipe.hydrology.basinPolicy,
      maximumAxisRun: recipe.hydrology.maximumAxisRun,
      maximumWidthJump: recipe.hydrology.maximumWidthJump
    },
    degradationOrder: recipe.degradationOrder,
    renderPalette: recipe.renderPalette,
    requiredCapabilityKeys,
    missingCapabilityKeys
  });
}
