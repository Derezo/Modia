import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WorldMapPathSystem } from '../WorldMapPathSystem.js';

function createScene({
  cleared = false,
  currentNodeId = 1,
  intermediateBlocked = true,
  discoveredNodeIds = null
} = {}) {
  const nodes = [
    { id: 1, node_type: 'castle', blocked: false, visited: true },
    { id: 2, node_type: 'forest', blocked: !cleared, visited: true },
    {
      id: 3,
      node_type: 'mountain',
      blocked: intermediateBlocked,
      visited: false
    },
    { id: 4, node_type: 'castle', blocked: false, visited: true }
  ];
  return {
    currentNode: nodes.find((node) => node.id === currentNodeId),
    nodes,
    connections: [
      { from_node_id: 1, to_node_id: 2 },
      { from_node_id: 2, to_node_id: 3 },
      { from_node_id: 3, to_node_id: 4 }
    ],
    isNodeDiscovered: (node) =>
      discoveredNodeIds === null || discoveredNodeIds.has(node.id)
  };
}

describe('WorldMapPathSystem blocked traversal contract', () => {
  it('exposes an uncleared blocker as a destination but does not expand through it', () => {
    const system = new WorldMapPathSystem(createScene());
    assert.deepEqual([...system.calculateReachableNodes()].sort(), [1, 2]);
  });

  it('expands through the same node after it is cleared', () => {
    const system = new WorldMapPathSystem(createScene({ cleared: true }));
    assert.deepEqual([...system.calculateReachableNodes()].sort(), [1, 2, 3]);
  });

  it('only exposes path-valid visited retreats from a blocked origin', () => {
    const system = new WorldMapPathSystem(createScene({ currentNodeId: 2 }));

    assert.deepEqual([...system.calculateReachableNodes()].sort(), [1, 2]);
    assert.equal(system.isNodeReachable(1), true);
    assert.equal(system.isNodeReachable(3), false);
    assert.equal(system.isNodeReachable(4), false);
  });

  it('requires a discovered intermediate for a blocked-origin retreat', () => {
    const discoveredNodeIds = new Set([1, 2, 4]);
    const system = new WorldMapPathSystem(createScene({
      currentNodeId: 2,
      intermediateBlocked: false,
      discoveredNodeIds
    }));

    assert.deepEqual([...system.calculateReachableNodes()].sort(), [1, 2]);
    assert.equal(system.isNodeReachable(4), false);

    discoveredNodeIds.add(3);
    assert.deepEqual([...system.calculateReachableNodes()].sort(), [1, 2, 4]);
    assert.equal(system.isNodeReachable(4), true);
  });
});
