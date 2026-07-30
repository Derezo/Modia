import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

let renderShrineInfo;

before(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = {
    createElement: tagName => ({
      tagName: tagName.toUpperCase(),
      style: {},
      textContent: ''
    }),
    head: {
      appendChild() {}
    }
  };

  const { NodeHoverTooltip } = await import('../NodeHoverTooltip.js');
  renderShrineInfo = NodeHoverTooltip.prototype.renderShrineInfo;
});

describe('NodeHoverTooltip shrine details', () => {
  it('uses the world-node shrine buff field and presents active cooldown timing', () => {
    const rows = [];
    const now = Date.now();
    const tooltip = {
      addRow(label, value, color) {
        rows.push({ label, value, color });
      }
    };

    renderShrineInfo.call(tooltip, {
      node_type: 'shrine',
      shrine_buff_type: 'stamina_regen',
      shrine_buff_active: true,
      shrine_buff_expires_at: new Date(now + (2 * 60 * 60 * 1000)).toISOString(),
      shrine_on_cooldown: true,
      shrine_cooldown_until: new Date(now + (4 * 60 * 60 * 1000)).toISOString()
    }, {
      zodiacCollection: null
    });

    assert.equal(
      rows.some(row => row.label === 'Blessing' && row.value === "Pilgrim's Rest"),
      true
    );
    assert.equal(
      rows.some(row => row.label === 'Status' && row.value === 'Blessing Active'),
      true
    );
    assert.equal(
      rows.some(row => row.label === 'Active For' && /^2h$/.test(row.value)),
      true
    );
    assert.equal(
      rows.some(row => row.label === 'Cooldown' && /^Ready in 4h$/.test(row.value)),
      true
    );
  });
});
