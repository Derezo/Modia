/**
 * POIGenerator - Generate points of interest for map topology
 *
 * Creates POI nodes including:
 * - Player spawn area (west side)
 * - Enemy spawn area (east side)
 * - Objectives (center or configurable)
 * - Secondary rooms via Poisson disk sampling
 *
 * POIs become nodes in the TopologyGraph, which is then used
 * to ensure all areas are connected and accessible.
 */

import { TopologyGraph, createTopologyGraph } from './TopologyGraph.js';

// ============================================================================
// POI TYPES
// ============================================================================

/**
 * POI type definitions
 */
export const POI_TYPES = {
  PLAYER_SPAWN: 'playerSpawn',
  ENEMY_SPAWN: 'enemySpawn',
  OBJECTIVE: 'objective',
  SECONDARY: 'secondary',
  CHOKEPOINT: 'chokepoint',
  HIGH_GROUND: 'highGround',
  COVER_ZONE: 'coverZone'
};

/**
 * POI roles for priority and connectivity
 */
export const POI_ROLES = {
  PRIMARY: 'primary',     // Must be connected with main paths
  SECONDARY: 'secondary', // Should be connected, can use shortcuts
  OPTIONAL: 'optional'    // Nice to have, lower priority
};

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default POI generation options
 */
export const DEFAULT_CONFIG = {
  // Map dimensions
  mapWidth: 32,
  mapHeight: 32,

  // Spawn configuration
  playerSpawnX: 3,
  enemySpawnX: null, // Auto: width - 4

  // Secondary room configuration
  secondaryRooms: 3,
  minSpacing: 6,

  // Objective configuration
  hasObjective: false,
  objectivePosition: 'center', // 'center', 'enemy', 'random'

  // Edge buffer (avoid placing POIs too close to edges)
  edgeBuffer: 4
};

// ============================================================================
// POI GENERATOR CLASS
// ============================================================================

/**
 * POIGenerator - Generates points of interest for map topology
 */
export class POIGenerator {
  /**
   * Create a POI generator
   *
   * @param {Object} config - Configuration options
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Calculate enemy spawn X if not provided
    if (this.config.enemySpawnX === null) {
      this.config.enemySpawnX = this.config.mapWidth - 4;
    }
  }

  /**
   * Generate all POIs for a map
   *
   * @param {function} random - Seeded random function
   * @param {Object} options - Generation options
   * @returns {TopologyGraph} Graph with POI nodes
   */
  generate(random, options = {}) {
    const config = { ...this.config, ...options };
    const graph = createTopologyGraph();

    // Generate spawn POIs
    this._addSpawnPOIs(graph, config);

    // Generate objective if configured
    if (config.hasObjective) {
      this._addObjectivePOI(graph, config, random);
    }

    // Generate secondary rooms using Poisson disk sampling
    this._addSecondaryPOIs(graph, config, random);

    return graph;
  }

  /**
   * Add player and enemy spawn POIs
   * @private
   */
  _addSpawnPOIs(graph, config) {
    const centerY = Math.floor(config.mapHeight / 2);

    // Player spawn (west side)
    graph.addNode('playerSpawn', {
      x: config.playerSpawnX,
      y: centerY,
      type: POI_TYPES.PLAYER_SPAWN,
      role: POI_ROLES.PRIMARY,
      bounds: {
        width: 5,
        height: Math.floor(config.mapHeight * 0.4)
      }
    });

    // Enemy spawn (east side)
    graph.addNode('enemySpawn', {
      x: config.enemySpawnX,
      y: centerY,
      type: POI_TYPES.ENEMY_SPAWN,
      role: POI_ROLES.PRIMARY,
      bounds: {
        width: 5,
        height: Math.floor(config.mapHeight * 0.4)
      }
    });
  }

  /**
   * Add objective POI
   * @private
   */
  _addObjectivePOI(graph, config, random) {
    let x, y;

    switch (config.objectivePosition) {
      case 'center':
        x = Math.floor(config.mapWidth / 2);
        y = Math.floor(config.mapHeight / 2);
        break;

      case 'enemy':
        x = config.enemySpawnX - 5;
        y = Math.floor(config.mapHeight / 2);
        break;

      case 'random':
        // Random position in center third of map
        const minX = Math.floor(config.mapWidth * 0.33);
        const maxX = Math.floor(config.mapWidth * 0.67);
        const minY = config.edgeBuffer;
        const maxY = config.mapHeight - config.edgeBuffer;
        x = minX + Math.floor(random() * (maxX - minX));
        y = minY + Math.floor(random() * (maxY - minY));
        break;

      default:
        x = Math.floor(config.mapWidth / 2);
        y = Math.floor(config.mapHeight / 2);
    }

    graph.addNode('objective', {
      x,
      y,
      type: POI_TYPES.OBJECTIVE,
      role: POI_ROLES.PRIMARY,
      bounds: { width: 5, height: 5 }
    });
  }

  /**
   * Add secondary room POIs using Poisson disk sampling
   * @private
   */
  _addSecondaryPOIs(graph, config, random) {
    if (config.secondaryRooms <= 0) return;

    // Get existing POI positions to avoid
    const existingPOIs = graph.getAllNodes();
    const avoidPositions = existingPOIs.map(poi => ({ x: poi.x, y: poi.y }));

    // Use Poisson disk sampling for even distribution
    const positions = this._poissonDiskSample(
      config.mapWidth,
      config.mapHeight,
      config.minSpacing,
      config.secondaryRooms,
      avoidPositions,
      config.edgeBuffer,
      random
    );

    // Add secondary POIs
    positions.forEach((pos, index) => {
      graph.addNode(`secondary_${index}`, {
        x: pos.x,
        y: pos.y,
        type: POI_TYPES.SECONDARY,
        role: POI_ROLES.SECONDARY,
        bounds: { width: 6 + Math.floor(random() * 4), height: 6 + Math.floor(random() * 4) }
      });
    });
  }

  /**
   * Poisson disk sampling for secondary room placement
   *
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {number} minSpacing - Minimum distance between samples
   * @param {number} count - Target number of samples
   * @param {Array} avoidPositions - Positions to avoid
   * @param {number} edgeBuffer - Buffer from map edges
   * @param {function} random - Seeded random function
   * @returns {Array<{x: number, y: number}>} Sample positions
   */
  _poissonDiskSample(width, height, minSpacing, count, avoidPositions, edgeBuffer, random) {
    const samples = [];
    const activeList = [];
    const k = 30; // Samples to try before rejecting

    // Effective bounds
    const minX = edgeBuffer;
    const maxX = width - edgeBuffer;
    const minY = edgeBuffer;
    const maxY = height - edgeBuffer;

    // Generate initial sample in center-ish area
    const initialX = minX + Math.floor(random() * (maxX - minX));
    const initialY = minY + Math.floor(random() * (maxY - minY));
    const initial = { x: initialX, y: initialY };

    // Check if initial is valid
    if (this._isValidSample(initial, samples, avoidPositions, minSpacing)) {
      samples.push(initial);
      activeList.push(initial);
    }

    // Generate samples
    while (activeList.length > 0 && samples.length < count) {
      // Pick random active sample
      const activeIdx = Math.floor(random() * activeList.length);
      const active = activeList[activeIdx];

      let found = false;

      // Try k samples around active point
      for (let i = 0; i < k; i++) {
        // Generate random point in annulus [r, 2r]
        const angle = random() * Math.PI * 2;
        const distance = minSpacing + random() * minSpacing;
        const newX = Math.round(active.x + Math.cos(angle) * distance);
        const newY = Math.round(active.y + Math.sin(angle) * distance);

        const candidate = { x: newX, y: newY };

        // Check bounds
        if (newX < minX || newX >= maxX || newY < minY || newY >= maxY) {
          continue;
        }

        // Check validity
        if (this._isValidSample(candidate, samples, avoidPositions, minSpacing)) {
          samples.push(candidate);
          activeList.push(candidate);
          found = true;
          break;
        }
      }

      // If no valid sample found, remove from active list
      if (!found) {
        activeList.splice(activeIdx, 1);
      }
    }

    return samples;
  }

  /**
   * Check if a sample position is valid
   * @private
   */
  _isValidSample(candidate, samples, avoidPositions, minSpacing) {
    // Check against existing samples
    for (const sample of samples) {
      const dist = Math.sqrt(
        Math.pow(candidate.x - sample.x, 2) +
        Math.pow(candidate.y - sample.y, 2)
      );
      if (dist < minSpacing) return false;
    }

    // Check against positions to avoid (with larger spacing)
    for (const avoid of avoidPositions) {
      const dist = Math.sqrt(
        Math.pow(candidate.x - avoid.x, 2) +
        Math.pow(candidate.y - avoid.y, 2)
      );
      // Use larger spacing for spawn areas
      if (dist < minSpacing * 1.5) return false;
    }

    return true;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Generate POIs for a map with default configuration
 *
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 * @param {Object} options - Additional options
 * @returns {TopologyGraph} Graph with POI nodes
 */
export function generatePOIs(width, height, random, options = {}) {
  const generator = new POIGenerator({
    mapWidth: width,
    mapHeight: height,
    ...options
  });
  return generator.generate(random, options);
}

/**
 * Create a POI generator with configuration
 *
 * @param {Object} config - Generator configuration
 * @returns {POIGenerator} Generator instance
 */
export function createPOIGenerator(config = {}) {
  return new POIGenerator(config);
}

export default POIGenerator;
