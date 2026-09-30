import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
globalThis.window ??= {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
}
globalThis.document ??= {
  createElement: () => ({ style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } }),
  getElementById: () => null,
  head: { appendChild: noop },
  documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } },
  body: { classList: { add: noop, remove: noop, toggle: noop } }
};

const { QuestProgressHUD } = await import('../QuestProgressHUD.js');

describe('QuestProgressHUD top offset', () => {
  it('publishes the offset below the canvas HUD panel, writing only on change', () => {
    const writes = [];
    const hud = Object.create(QuestProgressHUD.prototype);
    hud.topOffset = null;
    hud.element = { style: { setProperty: (name, value) => writes.push([name, value]) } };

    hud.setTopOffset(107.6);
    hud.setTopOffset(108.2);
    hud.setTopOffset(Number.NaN);
    hud.setTopOffset(60);

    assert.deepEqual(writes, [['--quest-hud-top', '108px'], ['--quest-hud-top', '60px']]);
  });
});
