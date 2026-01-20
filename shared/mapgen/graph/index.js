/**
 * Graph Module - Topology-driven map generation
 *
 * Provides graph-based tools for intentional map structure:
 * - POI generation for defining important locations
 * - Graph building with MST + configurable loopiness
 * - Topology analysis for connectivity verification
 */

// Topology graph data structure
export {
  TopologyGraph,
  createTopologyGraph
} from './TopologyGraph.js';

// POI generation
export {
  POIGenerator,
  POI_TYPES,
  POI_ROLES,
  generatePOIs,
  createPOIGenerator
} from './POIGenerator.js';

// Graph building with MST and extra edges
export {
  GraphBuilder,
  DungeonGraphBuilder,
  CaveGraphBuilder,
  ArenaGraphBuilder,
  buildGraph,
  createGraphBuilder
} from './GraphBuilder.js';
