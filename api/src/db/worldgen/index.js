/**
 * World Generation Module
 *
 * 6-Phase Regional World Generation System for the 5-region Modia world.
 *
 * Phases:
 * 1. Castle Placement - Force-directed + Lloyd's relaxation for 5 castle positions
 * 2. Voronoi Partitioning - Region boundaries from castle positions
 * 3. Internal Node Generation - Poisson disk sampling within each region
 * 4. Internal Connections - MST + extra connections per region
 * 5. Inter-Region Connections - Bridges, wilderness zones, trade routes, palace
 * 6. Deterministic finalization followed by pure canonical-graph validation
 */

// Export all constants
export * from './constants.js';

// Phase 1: Castle Placement
export {
  distanceBetween,
  findMinimumPairDistance,
  clampToBounds,
  applyForceDirectedRepulsion,
  applyLloydsRelaxation,
  generateCastlePlacements,
  validateCastlePlacement
} from './castlePlacement.js';

// Phase 2: Voronoi Partitioning
export {
  createVoronoiRegions,
  calculatePolygonProperties,
  extractVoronoiEdges,
  findSharedEdge,
  calculateEdgeLength,
  calculateEdgeMidpoint,
  extractVoronoiVertices,
  findGrandPalacePosition,
  findFarthestPointFromCastles,
  getRegionBorders,
  findRegionForPoint,
  validateVoronoiPartitioning
} from './voronoiPartitioning.js';

// Phase 3: Internal Node Generation
export {
  isPointInPolygon,
  getPolygonBoundingBox,
  poissonDiskSampleInPolygon,
  assignRegionNodeTypes,
  generateRegionNodes,
  generateAllRegionNodes,
  validateRegionNodeGeneration
} from './nodeGeneration.js';

// Phase 4: Internal Connections
export {
  isSettlement,
  isValidAdjacency,
  buildRegionMST,
  addExtraConnections,
  calculateRingDistances,
  enforceAdjacencyRules,
  ensureMinimumConnections,
  generateRegionConnections,
  generateAllRegionConnections,
  validateRegionConnections
} from './internalConnections.js';

// Phase 5: Inter-Region Connections
export {
  findNearestNodeInRegion,
  findFrontierNodes,
  generateBridgeName,
  createBridgeNode,
  createWildernessZone,
  createTradeRoute,
  createGrandPalace,
  generateInterRegionConnections,
  validateInterRegionConnections
} from './interRegionConnections.js';

// Finalized-world validation and legacy Phase 6 compatibility helpers
export {
  calculateDifficultyTier,
  assignTerminatorNodesRegional,
  verifyConnectivity,
  validateAndCleanup,
  validateFinalizedWorld,
  validatePhase6
} from './validation.js';

// Deterministic assembly boundary and versioned random-stream contract
export * from './randomStreams.js';
export { assembleWorld } from './worldAssembly.js';

// Terrain Generation
export {
  generateObstacles,
  generateNodeFeatures
} from './terrain.js';
