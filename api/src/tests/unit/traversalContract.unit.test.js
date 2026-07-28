import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateReachableNodeIds,
  isBlockingNode
} from '../../../../shared/constants.js';
import { bfsPath } from '../../services/world/pathfindingService.js';

const adjacency = new Map([
  [1, new Set([2])],
  [2, new Set([1, 3])],
  [3, new Set([2])]
]);
const nodeById = new Map([
  [1, { id: 1, node_type: 'castle' }],
  [2, { id: 2, node_type: 'forest' }],
  [3, { id: 3, node_type: 'mountain' }]
]);

describe('shared blocking traversal contract', () => {
  it('allows a blocked target without exposing the node behind it', () => {
    const blocked = new Set([2, 3]);
    const reachable = calculateReachableNodeIds({
      startNodeId: 1,
      adjacency,
      nodeById,
      isBlocked: (node) => blocked.has(node.id)
    });
    assert.deepEqual([...reachable].sort(), [1, 2]);
    assert.deepEqual(bfsPath(1, 2, adjacency, blocked), [1, 2]);
    assert.equal(bfsPath(1, 3, adjacency, blocked), null);
  });

  it('expands after clearance using the same combat classification', () => {
    const cleared = new Set([2]);
    assert.equal(isBlockingNode(nodeById.get(2), cleared), false);
    assert.equal(isBlockingNode(nodeById.get(3), cleared), true);
    const reachable = calculateReachableNodeIds({
      startNodeId: 1,
      adjacency,
      nodeById,
      isBlocked: (node) => isBlockingNode(node, cleared)
    });
    assert.deepEqual([...reachable].sort(), [1, 2, 3]);
    assert.deepEqual(bfsPath(1, 3, adjacency, new Set([3])), [1, 2, 3]);
  });

  it('does not traverse an undiscovered intermediate node', () => {
    const discovered = new Set([1, 3]);
    const blockedOrigin = new Set([1]);
    assert.equal(bfsPath(1, 3, adjacency, blockedOrigin, discovered), null);

    discovered.add(2);
    assert.deepEqual(
      bfsPath(1, 3, adjacency, blockedOrigin, discovered),
      [1, 2, 3]
    );
  });
});
