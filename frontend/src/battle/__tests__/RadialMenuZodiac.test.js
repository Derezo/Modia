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
  createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {} }
    };
  },
  getElementById() { return null; },
  head: { appendChild() {} }
};

const { RadialMenu } = await import('../RadialMenu.js');

describe('RadialMenu Zodiac action', () => {
  it('renders a sixth dedicated Zodiac segment and opens its submenu', () => {
    const menu = new RadialMenu({});
    let opened;
    menu.openSubmenu = type => { opened = type; };
    menu.callbacks = {
      canUseAction: action => action === 'zodiac'
    };

    assert.equal(menu.segmentAngle, 60);
    assert.match(menu.generateSVG(110, 110), /data-action="zodiac"/);
    menu.selectSegment('zodiac');
    assert.equal(opened, 'zodiac');
  });

  it('routes the Z shortcut through the Zodiac segment gate', () => {
    const calls = [];
    const menu = new RadialMenu({});
    menu.isVisible = true;
    menu.selectSegment = action => calls.push(action);

    menu.handleKeydown({
      key: 'z',
      preventDefault() { calls.push('prevented'); }
    });

    assert.deepEqual(calls, ['prevented', 'zodiac']);
  });
});
