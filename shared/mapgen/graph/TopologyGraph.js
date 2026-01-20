/**
 * TopologyGraph - Graph data structure for map topology
 *
 * Represents the high-level structure of a map as a graph where:
 * - Nodes are points of interest (spawn areas, rooms, objectives)
 * - Edges are connections that need paths carved between them
 *
 * Used by:
 * - POIGenerator: Creates nodes
 * - GraphBuilder: Creates edges (MST + extras)
 * - GraphRoomPlacer: Places rooms at node positions
 * - GraphCorridorCarver: Carves corridors along edges
 */

// ============================================================================
// TOPOLOGY GRAPH CLASS
// ============================================================================

/**
 * TopologyGraph - Manages map topology as a graph structure
 */
export class TopologyGraph {
  constructor() {
    // Nodes: Map<nodeId, NodeData>
    this.nodes = new Map();

    // Edges: Array of { from, to, weight, type, data }
    this.edges = [];

    // Adjacency list for fast lookups
    this.adjacency = new Map();
  }

  // ==========================================================================
  // NODE METHODS
  // ==========================================================================

  /**
   * Add a node to the graph
   *
   * @param {string} id - Unique node identifier
   * @param {Object} data - Node data
   * @param {number} data.x - X position
   * @param {number} data.y - Y position
   * @param {string} data.type - Node type (playerSpawn, enemySpawn, room, objective, etc.)
   * @param {string} data.role - Node role for priority (primary, secondary, etc.)
   * @param {Object} data.bounds - Optional bounds { width, height }
   */
  addNode(id, data) {
    if (this.nodes.has(id)) {
      console.warn(`Node "${id}" already exists, updating`);
    }

    this.nodes.set(id, {
      id,
      ...data,
      connections: []
    });

    // Initialize adjacency list entry
    if (!this.adjacency.has(id)) {
      this.adjacency.set(id, new Set());
    }
  }

  /**
   * Get a node by ID
   *
   * @param {string} id - Node ID
   * @returns {Object|null} Node data or null
   */
  getNode(id) {
    return this.nodes.get(id) || null;
  }

  /**
   * Remove a node and its edges
   *
   * @param {string} id - Node ID to remove
   */
  removeNode(id) {
    if (!this.nodes.has(id)) return;

    // Remove all edges involving this node
    this.edges = this.edges.filter(edge =>
      edge.from !== id && edge.to !== id
    );

    // Remove from adjacency lists
    const adjacent = this.adjacency.get(id) || new Set();
    for (const neighborId of adjacent) {
      const neighborAdj = this.adjacency.get(neighborId);
      if (neighborAdj) neighborAdj.delete(id);
    }
    this.adjacency.delete(id);

    // Remove node
    this.nodes.delete(id);
  }

  /**
   * Get all nodes
   *
   * @returns {Array} Array of node data objects
   */
  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  /**
   * Get nodes by type
   *
   * @param {string} type - Node type to filter by
   * @returns {Array} Matching nodes
   */
  getNodesByType(type) {
    return this.getAllNodes().filter(node => node.type === type);
  }

  /**
   * Get nodes by role
   *
   * @param {string} role - Node role to filter by
   * @returns {Array} Matching nodes
   */
  getNodesByRole(role) {
    return this.getAllNodes().filter(node => node.role === role);
  }

  // ==========================================================================
  // EDGE METHODS
  // ==========================================================================

  /**
   * Add an edge between two nodes
   *
   * @param {string} fromId - Source node ID
   * @param {string} toId - Target node ID
   * @param {Object} options - Edge options
   * @param {number} options.weight - Edge weight (default: Euclidean distance)
   * @param {string} options.type - Edge type (main, secondary, shortcut)
   * @param {Object} options.data - Additional edge data
   */
  addEdge(fromId, toId, options = {}) {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);

    if (!fromNode || !toNode) {
      console.warn(`Cannot add edge: nodes "${fromId}" or "${toId}" not found`);
      return;
    }

    // Don't add duplicate edges
    if (this.hasEdge(fromId, toId)) {
      return;
    }

    // Calculate default weight (Euclidean distance)
    const weight = options.weight ??
      Math.sqrt(Math.pow(toNode.x - fromNode.x, 2) + Math.pow(toNode.y - fromNode.y, 2));

    const edge = {
      from: fromId,
      to: toId,
      weight,
      type: options.type || 'main',
      data: options.data || {}
    };

    this.edges.push(edge);

    // Update adjacency lists (bidirectional)
    this.adjacency.get(fromId).add(toId);
    this.adjacency.get(toId).add(fromId);

    // Update node connections
    fromNode.connections.push(toId);
    toNode.connections.push(fromId);
  }

  /**
   * Check if an edge exists between two nodes
   *
   * @param {string} fromId - First node ID
   * @param {string} toId - Second node ID
   * @returns {boolean} True if edge exists
   */
  hasEdge(fromId, toId) {
    return this.edges.some(edge =>
      (edge.from === fromId && edge.to === toId) ||
      (edge.from === toId && edge.to === fromId)
    );
  }

  /**
   * Get an edge between two nodes
   *
   * @param {string} fromId - First node ID
   * @param {string} toId - Second node ID
   * @returns {Object|null} Edge object or null
   */
  getEdge(fromId, toId) {
    return this.edges.find(edge =>
      (edge.from === fromId && edge.to === toId) ||
      (edge.from === toId && edge.to === fromId)
    ) || null;
  }

  /**
   * Get all edges
   *
   * @returns {Array} Array of edge objects
   */
  getAllEdges() {
    return [...this.edges];
  }

  /**
   * Get edges by type
   *
   * @param {string} type - Edge type to filter by
   * @returns {Array} Matching edges
   */
  getEdgesByType(type) {
    return this.edges.filter(edge => edge.type === type);
  }

  /**
   * Get edges connected to a node
   *
   * @param {string} nodeId - Node ID
   * @returns {Array} Edges connected to the node
   */
  getEdgesForNode(nodeId) {
    return this.edges.filter(edge =>
      edge.from === nodeId || edge.to === nodeId
    );
  }

  /**
   * Get neighbors of a node
   *
   * @param {string} nodeId - Node ID
   * @returns {Array} Adjacent node data objects
   */
  getNeighbors(nodeId) {
    const adjacent = this.adjacency.get(nodeId);
    if (!adjacent) return [];

    return Array.from(adjacent).map(id => this.nodes.get(id)).filter(Boolean);
  }

  // ==========================================================================
  // GRAPH ALGORITHMS
  // ==========================================================================

  /**
   * Calculate distance between two nodes
   *
   * @param {string} fromId - First node ID
   * @param {string} toId - Second node ID
   * @returns {number} Euclidean distance
   */
  getDistance(fromId, toId) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return Infinity;

    return Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
  }

  /**
   * Calculate Manhattan distance between two nodes
   *
   * @param {string} fromId - First node ID
   * @param {string} toId - Second node ID
   * @returns {number} Manhattan distance
   */
  getManhattanDistance(fromId, toId) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return Infinity;

    return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  }

  /**
   * Find the shortest path between two nodes (Dijkstra)
   *
   * @param {string} startId - Start node ID
   * @param {string} endId - End node ID
   * @returns {Array|null} Array of node IDs or null if no path
   */
  findPath(startId, endId) {
    if (!this.nodes.has(startId) || !this.nodes.has(endId)) {
      return null;
    }

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.nodes.keys());

    // Initialize distances
    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, nodeId === startId ? 0 : Infinity);
    }

    while (unvisited.size > 0) {
      // Find unvisited node with smallest distance
      let current = null;
      let minDist = Infinity;
      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId);
        if (dist < minDist) {
          minDist = dist;
          current = nodeId;
        }
      }

      if (current === null || minDist === Infinity) break;
      if (current === endId) break;

      unvisited.delete(current);

      // Update distances to neighbors
      const neighbors = this.adjacency.get(current) || new Set();
      for (const neighborId of neighbors) {
        if (!unvisited.has(neighborId)) continue;

        const edge = this.getEdge(current, neighborId);
        const alt = distances.get(current) + (edge?.weight || 1);

        if (alt < distances.get(neighborId)) {
          distances.set(neighborId, alt);
          previous.set(neighborId, current);
        }
      }
    }

    // Reconstruct path
    if (!previous.has(endId) && startId !== endId) {
      return null; // No path found
    }

    const path = [];
    let current = endId;
    while (current !== undefined) {
      path.unshift(current);
      current = previous.get(current);
    }

    return path;
  }

  /**
   * Check if the graph is connected (all nodes reachable)
   *
   * @returns {boolean} True if connected
   */
  isConnected() {
    if (this.nodes.size === 0) return true;
    if (this.nodes.size === 1) return true;

    // BFS from first node
    const firstId = this.nodes.keys().next().value;
    const visited = new Set();
    const queue = [firstId];
    visited.add(firstId);

    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = this.adjacency.get(current) || new Set();

      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    return visited.size === this.nodes.size;
  }

  /**
   * Get connected components
   *
   * @returns {Array<Array<string>>} Array of components (each is array of node IDs)
   */
  getConnectedComponents() {
    const visited = new Set();
    const components = [];

    for (const nodeId of this.nodes.keys()) {
      if (visited.has(nodeId)) continue;

      const component = [];
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift();
        component.push(current);

        const neighbors = this.adjacency.get(current) || new Set();
        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        }
      }

      components.push(component);
    }

    return components;
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Get total edge weight
   *
   * @returns {number} Sum of all edge weights
   */
  getTotalWeight() {
    return this.edges.reduce((sum, edge) => sum + edge.weight, 0);
  }

  /**
   * Get graph statistics
   *
   * @returns {Object} Graph statistics
   */
  getStats() {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      isConnected: this.isConnected(),
      componentCount: this.getConnectedComponents().length,
      totalWeight: this.getTotalWeight(),
      mainEdges: this.getEdgesByType('main').length,
      secondaryEdges: this.getEdgesByType('secondary').length
    };
  }

  /**
   * Clear the graph
   */
  clear() {
    this.nodes.clear();
    this.edges = [];
    this.adjacency.clear();
  }

  /**
   * Export graph data for serialization
   *
   * @returns {Object} Serializable graph data
   */
  export() {
    return {
      nodes: Array.from(this.nodes.entries()).map(([id, data]) => ({
        id,
        ...data,
        connections: undefined // Rebuilt from edges
      })),
      edges: this.edges.map(edge => ({
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
        type: edge.type,
        data: edge.data
      }))
    };
  }

  /**
   * Import graph data
   *
   * @param {Object} data - Graph data from export()
   */
  import(data) {
    this.clear();

    // Add nodes
    for (const nodeData of data.nodes) {
      this.addNode(nodeData.id, nodeData);
    }

    // Add edges
    for (const edgeData of data.edges) {
      this.addEdge(edgeData.from, edgeData.to, {
        weight: edgeData.weight,
        type: edgeData.type,
        data: edgeData.data
      });
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new topology graph
 *
 * @returns {TopologyGraph} New graph instance
 */
export function createTopologyGraph() {
  return new TopologyGraph();
}

export default TopologyGraph;
