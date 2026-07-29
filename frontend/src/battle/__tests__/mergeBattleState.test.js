import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyBattleMapPatch, mergeBattleStatePatch } from '../mergeBattleState.js';

describe('mergeBattleStatePatch', () => {
  it('preserves omitted state and merges sparse unit patches by ID', () => {
    const current = {
      activeUnitId: 10,
      round: 2,
      terrain: [['grass']],
      units: [
        { id: 10, class: 'warrior', hp: 20, mp: 5, tileX: 1, tileY: 2 },
        { id: 11, enemyId: 'slime', hp: 9, tileX: 3, tileY: 4 }
      ]
    };

    const merged = mergeBattleStatePatch(current, {
      round: 3,
      units: [{ id: 10, hp: 12 }]
    });

    assert.equal(merged.activeUnitId, 10);
    assert.equal(merged.round, 3);
    assert.equal(merged.terrain, current.terrain);
    assert.deepEqual(merged.units, [
      { id: 10, class: 'warrior', hp: 12, mp: 5, tileX: 1, tileY: 2 },
      { id: 11, enemyId: 'slime', hp: 9, tileX: 3, tileY: 4 }
    ]);
    assert.equal(current.units[0].hp, 20);
  });

  it('appends previously unseen units without dropping existing ones', () => {
    const merged = mergeBattleStatePatch(
      { units: [{ id: 1, hp: 5 }] },
      { units: [{ id: 2, hp: 7 }] }
    );

    assert.deepEqual(merged.units, [{ id: 1, hp: 5 }, { id: 2, hp: 7 }]);
  });
});

describe('applyBattleMapPatch', () => {
  it('applies every authoritative map layer from an explicit sync snapshot', () => {
    const calls = [];
    const grid = {
      setTerrain(value) { calls.push(['terrain', value]); },
      setElevation(value, format) { calls.push(['elevation', value, format]); },
      setTileVariants(value) { calls.push(['variants', value]); },
      setObstacles(value) { calls.push(['obstacles', value]); },
      setElevationConnections(value) { calls.push(['connections', value]); },
      setTransitions(value) { calls.push(['transitions', value]); },
      setDecorations(value) { calls.push(['decorations', value]); }
    };
    const patch = {
      nodeType: 'mountain',
      terrain: [['stone']],
      elevation: [[0.54]],
      elevationFormat: 'normalized',
      variants: [[3]],
      obstacles: [{ id: 'tree', x: 0, y: 0, kind: 'tree', blocking: true }],
      elevationConnections: [{
        id: 'ramp',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        kind: 'ramp'
      }],
      transitions: [{ id: 'snow-edge', x: 0, y: 0 }],
      decorations: [{ id: 'snow-drift', x: 0, y: 0 }]
    };

    applyBattleMapPatch(grid, patch);

    assert.equal(grid.nodeType, 'mountain');
    assert.deepEqual(calls, [
      ['terrain', patch.terrain],
      ['elevation', patch.elevation, 'normalized'],
      ['variants', patch.variants],
      ['obstacles', patch.obstacles],
      ['connections', patch.elevationConnections],
      ['transitions', patch.transitions],
      ['decorations', patch.decorations]
    ]);
  });
});
