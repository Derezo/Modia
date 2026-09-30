/**
 * Travel quest progress runs its updates one at a time.
 *
 * updateProgress is an autocommit read-modify-write of one quest row, so
 * parallel calls lost updates (a 5-node path advanced 'visit N nodes' by 1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { trackTravelQuestProgress } from '../../services/world/travelQuestProgress.js';

function fakeQuestRow() {
  // Emulates the read-modify-write: read, yield, then write back read+1
  const row = { progress: 0, visited: [] };
  let inFlight = 0;
  let maxInFlight = 0;
  const calls = [];
  const updateProgress = async (characterId, objective, amount, metadata) => {
    calls.push([characterId, objective, amount, metadata]);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const snapshot = { progress: row.progress, visited: [...row.visited] };
    await new Promise(resolve => setImmediate(resolve));
    if (objective === 'visit_nodes' && !snapshot.visited.includes(metadata.nodeId)) {
      row.progress = snapshot.progress + amount;
      row.visited = [...snapshot.visited, metadata.nodeId];
    }
    inFlight--;
  };
  return { row, calls, updateProgress, maxInFlight: () => maxInFlight };
}

describe('trackTravelQuestProgress', () => {
  it('counts every node after the origin without losing updates', async () => {
    const quest = fakeQuestRow();
    const path = [1, 2, 3, 4, 5].map(id => ({ id, node_type: id === 3 ? 'shrine' : 'wilderness' }));

    await trackTravelQuestProgress(9, path, { region_id: 4 }, quest.updateProgress);

    assert.equal(quest.maxInFlight(), 1, 'updates never overlap');
    assert.equal(quest.row.progress, 4);
    assert.deepEqual(quest.row.visited, [2, 3, 4, 5]);
    assert.deepEqual(quest.calls.map(c => c[1]), ['visit_nodes', 'visit_nodes', 'visit_nodes', 'visit_nodes', 'visit_regions']);
    assert.deepEqual(quest.calls[1][3], { nodeType: 'shrine', nodeId: 3 });
    assert.deepEqual(quest.calls[4][3], { regionId: 4 });
  });

  it('keeps going after a failed update and skips the region without one', async () => {
    const seen = [];
    await trackTravelQuestProgress(9, [{ id: 1 }, { id: 2 }, { id: 3 }], null, async (id, objective, amount, meta) => {
      seen.push(meta.nodeId ?? meta.regionId);
      if (meta.nodeId === 2) throw new Error('boom');
    });
    assert.deepEqual(seen, [2, 3]);
  });
});
