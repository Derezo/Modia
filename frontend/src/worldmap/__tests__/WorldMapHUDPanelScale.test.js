import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= {
  innerWidth: 390,
  innerHeight: 844,
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; }
};
const stubElement = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
  appendChild() {}, setAttribute() {}, addEventListener() {}, getContext() { return null; }
});
globalThis.document ??= {
  createElement: stubElement,
  head: { appendChild() {} },
  body: { appendChild() {} },
  documentElement: { style: { setProperty() {} } },
  getElementById() { return null; },
  addEventListener() {}
};
globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };

const { WorldMapHUDPanel } = await import('../WorldMapHUDPanel.js');

describe('WorldMapHUDPanel display scale', () => {
  it('stays at design size on desktop', () => {
    const panel = new WorldMapHUDPanel({ collapsed: true });
    panel.setDisplayScale(1.2);
    assert.equal(panel.getUpscale(), 1);
    assert.equal(panel.containsPoint(10 + 112, 10 + 50), true);
    assert.equal(panel.containsPoint(10 + 113, 10), false);
  });

  it('enlarges the chip on a half-size phone canvas and hit-tests the enlarged area', () => {
    const panel = new WorldMapHUDPanel({ collapsed: true });
    panel.setDisplayScale(0.49);
    const k = panel.getUpscale();
    assert.ok(k > 2 && k <= 2.2, `upscale ${k}`);
    // A tap inside the enlarged chip (beyond the unscaled 112px) expands it
    assert.equal(panel.handleClick(10 + 200, 10 + 90), true);
    assert.equal(panel.collapsed, false);
  });
});
