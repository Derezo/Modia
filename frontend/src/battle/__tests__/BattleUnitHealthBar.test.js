import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0 }
});
globalThis.document = {
  createElement() { return { id: '', textContent: '' }; },
  head: { appendChild() {} }
};

const { BattleUnit } = await import('../BattleUnit.js');

function healthBarHarness(hp, animationState = 'idle') {
  const unit = Object.create(BattleUnit.prototype);
  Object.assign(unit, {
    hp,
    maxHp: 10,
    animationState
  });

  const calls = [];
  const ctx = {
    fillRect(...args) { calls.push({ method: 'fillRect', args }); },
    strokeRect(...args) { calls.push({ method: 'strokeRect', args }); }
  };

  return { unit, ctx, calls };
}

describe('BattleUnit HP bar rendering', () => {
  it('draws the HP background, fill, and border for a living unit', () => {
    const { unit, ctx, calls } = healthBarHarness(5);

    unit.renderHPBar(ctx, 20, 30);

    assert.deepEqual(calls, [
      { method: 'fillRect', args: [4, 30, 32, 4] },
      { method: 'fillRect', args: [4, 30, 16, 4] },
      { method: 'strokeRect', args: [4, 30, 32, 4] }
    ]);
  });

  it('does not draw an HP bar during either the death transition or corpse pose', () => {
    for (const [hp, animationState] of [[0, 'death'], [-1, 'dead']]) {
      const { unit, ctx, calls } = healthBarHarness(hp, animationState);

      unit.renderHPBar(ctx, 20, 30);

      assert.deepEqual(calls, [], `${animationState} unit with ${hp} HP drew an HP bar`);
    }
  });

  it('draws the HP bar again after a dead unit is revived', () => {
    const { unit, ctx, calls } = healthBarHarness(0, 'dead');

    unit.renderHPBar(ctx, 20, 30);
    unit.hp = 4;
    unit.animationState = 'idle';
    unit.renderHPBar(ctx, 20, 30);

    assert.equal(calls.filter(({ method }) => method === 'fillRect').length, 2);
    assert.equal(calls.filter(({ method }) => method === 'strokeRect').length, 1);
  });
});
