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
  value: globalThis.navigator || { maxTouchPoints: 0 }
});
globalThis.document ??= {
  createElement() {
    return { style: {}, classList: { add() {}, remove() {} } };
  },
  head: { appendChild() {} }
};

const { BattleActionBar } = await import('../BattleActionBar.js');

describe('BattleActionBar authoritative gate delegation', () => {
  it('delegates button clicks instead of trusting stale private booleans', () => {
    const calls = [];
    const bar = new BattleActionBar({});
    bar.canAct = false;
    bar.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return true;
      },
      onAttack() {
        calls.push(['attack']);
      }
    };

    assert.equal(bar.handleActionClick('attack'), true);
    assert.deepEqual(calls, [['gate', 'attack'], ['attack']]);
  });

  it('routes keyboard shortcuts through the same gate and blocks callbacks', () => {
    const calls = [];
    const bar = new BattleActionBar({});
    bar.isVisible = true;
    bar.canAct = true;
    bar.closeDropdown = () => calls.push(['closed']);
    bar.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return false;
      },
      onSkillSelect() {
        calls.push(['skill']);
      }
    };
    const event = {
      key: 's',
      preventDefault() {
        calls.push(['prevented']);
      }
    };

    bar.handleKeydown(event);

    assert.deepEqual(calls, [
      ['prevented'],
      ['gate', 'skill'],
      ['closed']
    ]);
  });
});
