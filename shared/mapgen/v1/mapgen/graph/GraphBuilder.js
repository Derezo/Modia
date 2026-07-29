/**
 * GraphBuilder - Build graph edges with MST and configurable loopiness
 *
 * Takes a TopologyGraph with POI nodes and creates edges:
 * 1. Minimum Spanning Tree (MST) ensures all nodes connected
 * 2. Additional edges based on loopiness config add alternate paths
 *
 * Loopiness values:
 * - 0.0: Pure MST (single path between any two nodes)
 * - 0.5: Some shortcuts and loops
 * - 1.0: Highly connected (many alternate routes)
 */

// ============================================================================
// GRAPH BUILDER CLASS
// ============================================================================

/**
 * GraphBuilder - Builds edges for a topology graph
 */
export class GraphBuilder {
  /**
   * Create a graph builder
   *
   * @param {Object} options - Builder options
   * @param {number} options.loopiness - How many extra edges to add (0-1)
   * @param {number} options.maxEdgeLength - Maximum edge length (default: Infinity)
   * @param {boolean} options.prioritizeSpawns - Ensure good spawn connectivity
   */
  constructor(options = {}) {
    this.loopiness = options.loopiness ?? 0.3;
    this.maxEdgeLength = options.maxEdgeLength ?? Infinity;
    this.prioritizeSpawns = options.prioritizeSpawns !== false;
  }

  /**
   * Build edges for a topology graph
   *
   * @param {TopologyGraph} graph - Graph with nodes, no edges
   * @param {function} random - Seeded random function
   * @returns {TopologyGraph} Same graph with edges added
   */
  build(graph, random) {
    const nodes = graph.getAllNodes();

    if (nodes.length < 2) {
      return graph; // Nothing to connect
    }

    // Build MST first
    this._buildMST(graph, nodes);

    // Add extra edges based on loopiness
    this._addExtraEdges(graph, nodes, random);

    return graph;
  }

  /**
   * Build Minimum Spanning Tree using Prim's algorithm
   * @private
   */
  _buildMST(graph, nodes) {
    if (nodes.length === 0) return;

    // Start with spawn nodes if available, otherwise first node
    const spawnNodes = nodes.filter(n =>
      n.type === 'playerSpawn' || n.type === 'enemySpawn'
    );
    const startNode = spawnNodes[0] || nodes[0];

    const inTree = new Set([startNode.id]);
    const edgeCandidates = [];

    // Initialize edge candidates from start node
    this._addEdgeCandidates(startNode, nodes, inTree, edgeCandidates);

    // Build MST
    while (inTree.size < nodes.length && edgeCandidates.length > 0) {
      // Sort by weight (ascending)
      edgeCandidates.sort((a, b) => a.weight - b.weight);

      // Find first edge that connects to a new node
      let added = false;
      for (let i = 0; i < edgeCandidates.length; i++) {
        const edge = edgeCandidates[i];

        // Check if this edge goes to a node not in tree
        const targetId = inTree.has(edge.from) ? edge.to : edge.from;
        if (inTree.has(targetId)) continue;

        // Check edge length limit
        if (edge.weight > this.maxEdgeLength) continue;

        // Add edge
        graph.addEdge(edge.from, edge.to, {
          weight: edge.weight,
          type: 'main'
        });

        // Add node to tree
        inTree.add(targetId);
        const targetNode = graph.getNode(targetId);

        // Add new candidates
        this._addEdgeCandidates(targetNode, nodes, inTree, edgeCandidates);

        // Remove used edge
        edgeCandidates.splice(i, 1);
        added = true;
        break;
      }

      if (!added) break; // No valid edges found
    }
  }

  /**
   * Add edge candidates from a node to all other nodes not in tree
   * @private
   */
  _addEdgeCandidates(fromNode, allNodes, inTree, candidates) {
    for (const toNode of allNodes) {
      if (fromNode.id === toNode.id) continue;
      if (inTree.has(toNode.id)) continue;

      // Check if edge already in candidates
      const exists = candidates.some(c =>
        (c.from === fromNode.id && c.to === toNode.id) ||
        (c.from === toNode.id && c.to === fromNode.id)
      );
      if (exists) continue;

      const weight = Math.sqrt(
        Math.pow(toNode.x - fromNode.x, 2) +
        Math.pow(toNode.y - fromNode.y, 2)
      );

      candidates.push({
        from: fromNode.id,
        to: toNode.id,
        weight
      });
    }
  }

  /**
   * Add extra edges beyond MST based on loopiness
   * @private
   */
  _addExtraEdges(graph, nodes, random) {
    if (this.loopiness <= 0) return;

    // Calculate potential extra edges
    const potentialEdges = [];

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const from = nodes[i];
        const to = nodes[j];

        // Skip if edge already exists
        if (graph.hasEdge(from.id, to.id)) continue;

        const weight = Math.sqrt(
          Math.pow(to.x - from.x, 2) +
          Math.pow(to.y - from.y, 2)
        );

        // Skip edges that are too long
        if (weight > this.maxEdgeLength) continue;

        // Calculate edge priority based on node types
        let priority = 1.0;

        // Prioritize edges between spawns
        if (this.prioritizeSpawns) {
          const isSpawnEdge = (from.type === 'playerSpawn' || from.type === 'enemySpawn') &&
                             (to.type === 'playerSpawn' || to.type === 'enemySpawn');
          if (isSpawnEdge) priority = 0.5; // Lower is better

          // Slightly prioritize edges to/from objectives
          if (from.type === 'objective' || to.type === 'objective') {
            priority = 0.7;
          }
        }

        // Penalize very long edges
        priority *= (1 + weight / this.maxEdgeLength);

        potentialEdges.push({
          from: from.id,
          to: to.id,
          weight,
          priority
        });
      }
    }

    // Sort by priority (lower is better)
    potentialEdges.sort((a, b) => a.priority - b.priority);

    // Determine how many extra edges to add
    const mstEdgeCount = graph.getAllEdges().length;
    const maxExtraEdges = Math.floor(mstEdgeCount * this.loopiness * 2);

    // Add edges probabilistically
    let addedCount = 0;
    for (const edge of potentialEdges) {
      if (addedCount >= maxExtraEdges) break;

      // Probability decreases as we add more edges
      const addProbability = this.loopiness * (1 - addedCount / maxExtraEdges);
      if (random() < addProbability) {
        graph.addEdge(edge.from, edge.to, {
          weight: edge.weight,
          type: 'secondary'
        });
        addedCount++;
      }
    }
  }
}

// ============================================================================
// SPECIALIZED BUILDERS
// ============================================================================

/**
 * DungeonGraphBuilder - Builds graphs optimized for dungeon layouts
 */
export class DungeonGraphBuilder extends GraphBuilder {
  constructor(options = {}) {
    super({
      loopiness: options.loopiness ?? 0.2,
      maxEdgeLength: options.maxEdgeLength ?? 20,
      ...options
    });
  }

  /**
   * Build with corridor-style connections
   */
  build(graph, random) {
    super.build(graph, random);

    // Mark short edges for wider corridors
    const edges = graph.getAllEdges();
    for (const edge of edges) {
      if (edge.weight < 10) {
        edge.data.corridorWidth = 3;
      } else {
        edge.data.corridorWidth = 2;
      }
    }

    return graph;
  }
}

/**
 * CaveGraphBuilder - Builds graphs optimized for organic cave layouts
 */
export class CaveGraphBuilder extends GraphBuilder {
  constructor(options = {}) {
    super({
      loopiness: options.loopiness ?? 0.4,
      maxEdgeLength: options.maxEdgeLength ?? 25,
      ...options
    });
  }

  /**
   * Build with organic path suggestions
   */
  build(graph, random) {
    super.build(graph, random);

    // Mark edges for winding paths
    const edges = graph.getAllEdges();
    for (const edge of edges) {
      edge.data.wanderStrength = 0.3 + random() * 0.2;
      edge.data.pathStyle = 'drunkard';
    }

    return graph;
  }
}

/**
 * ArenaGraphBuilder - Builds minimal graphs for arena-style maps
 */
export class ArenaGraphBuilder extends GraphBuilder {
  constructor(options = {}) {
    super({
      loopiness: options.loopiness ?? 0.0, // No loops in arena
      maxEdgeLength: Infinity,
      ...options
    });
  }

  /**
   * Build with central hub pattern
   */
  build(graph, random) {
    const nodes = graph.getAllNodes();

    // For arenas, connect all secondary nodes to center if there's an objective
    const objective = nodes.find(n => n.type === 'objective');
    const spawns = nodes.filter(n =>
      n.type === 'playerSpawn' || n.type === 'enemySpawn'
    );

    if (objective) {
      // Connect spawns to objective
      for (const spawn of spawns) {
        graph.addEdge(spawn.id, objective.id, { type: 'main' });
      }

      // Connect other nodes to objective
      for (const node of nodes) {
        if (node.type === 'objective') continue;
        if (spawns.includes(node)) continue;
        graph.addEdge(node.id, objective.id, { type: 'secondary' });
      }
    } else {
      // No objective - use MST
      super.build(graph, random);
    }

    return graph;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Build graph with default configuration
 *
 * @param {TopologyGraph} graph - Graph with nodes
 * @param {function} random - Seeded random function
 * @param {Object} options - Builder options
 * @returns {TopologyGraph} Graph with edges
 */
export function buildGraph(graph, random, options = {}) {
  const builder = new GraphBuilder(options);
  return builder.build(graph, random);
}

/**
 * Create a graph builder
 *
 * @param {string} type - Builder type ('default', 'dungeon', 'cave', 'arena')
 * @param {Object} options - Builder options
 * @returns {GraphBuilder} Builder instance
 */
export function createGraphBuilder(type = 'default', options = {}) {
  switch (type) {
    case 'dungeon':
      return new DungeonGraphBuilder(options);
    case 'cave':
      return new CaveGraphBuilder(options);
    case 'arena':
      return new ArenaGraphBuilder(options);
    default:
      return new GraphBuilder(options);
  }
}

export default GraphBuilder;
