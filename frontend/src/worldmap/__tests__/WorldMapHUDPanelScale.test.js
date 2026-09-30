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

describe('WorldMapHUDPanel collapsibility follows the breakpoint', () => {
  // A point inside the expanded panel but outside the zodiac segment
  function clickBody(panel) {
    panel.zodiacSegment.containsPoint = () => false;
    return panel.handleClick(20, 20);
  }

  it('a desktop panel that becomes mobile can be folded back after expanding', () => {
    const panel = new WorldMapHUDPanel({ collapsed: false });
    panel.setCollapsed(true); // resize to phone
    assert.equal(clickBody(panel), true); // tap chip: expand
    assert.equal(panel.collapsed, false);
    assert.equal(clickBody(panel), true); // tap panel: fold
    assert.equal(panel.collapsed, true);
  });

  it('a phone panel that becomes desktop is not folded by a click', () => {
    const panel = new WorldMapHUDPanel({ collapsed: true });
    panel.setCollapsed(false); // resize to desktop
    assert.equal(clickBody(panel), false);
    assert.equal(panel.collapsed, false);
  });
});

describe('WorldMapHUDPanel bottom edge for DOM overlays', () => {
  it('reports the expanded panel bottom in CSS pixels at desktop scale', () => {
    const panel = new WorldMapHUDPanel({ collapsed: false });
    panel.setDisplayScale(1);
    assert.equal(panel.getBottomCssOffset(), 10 + Math.ceil(panel.currentHeight));
  });

  it('accounts for the phone upscale and the collapsed chip', () => {
    const panel = new WorldMapHUDPanel({ collapsed: true });
    panel.setDisplayScale(0.5);
    const k = panel.getUpscale();
    assert.equal(panel.getBottomCssOffset(), (10 + 50 * k) * 0.5);
    panel.setCollapsed(false);
    assert.ok(panel.getBottomCssOffset() > (10 + 50 * k) * 0.5);
  });
});
