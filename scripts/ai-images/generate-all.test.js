const test = require('node:test');
const assert = require('node:assert/strict');

const { getActiveTotals } = require('./generate-all.js');

test('aggregate status excludes character counts owned by reviewed authored pipelines', () => {
  const totals = getActiveTotals({
    categories: {
      tiles: { generated: 8, total: 10 },
      portraits: { generated: 5, total: 5 },
      characters: { generated: 1, total: 999 }
    }
  });

  assert.deepEqual(totals, {
    generated: 13,
    total: 15,
    percentComplete: 87
  });
});
