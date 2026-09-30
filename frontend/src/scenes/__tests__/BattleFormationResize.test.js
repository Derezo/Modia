import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return {
        url: new URL(`../../../../shared/${specifier.slice('@shared/'.length)}`, import.meta.url).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

const noop = () => {};
globalThis.window ??= {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
}
globalThis.document ??= {
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, setAttribute: noop }),
  getElementById: () => null,
  head: { appendChild: noop },
  documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } },
  body: { classList: { add: noop, remove: noop, toggle: noop } }
};

const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
};

const { BattleFormationScene } = await import('../BattleFormationScene.js');

function sceneWithGridArea(clientWidth, clientHeight) {
  const scene = Object.create(BattleFormationScene.prototype);
  const gridArea = { clientWidth, clientHeight };
  scene.uiElement = { querySelector: (sel) => (sel === '.bf-grid-area' ? gridArea : null) };
  scene.gridCanvas = { style: {}, width: 0, height: 0, getContext: () => ({ setTransform: noop }) };
  scene.isMobile = false;
  scene.formationGrid = null;
  scene.resizeObserver = null;
  return scene;
}

describe('BattleFormationScene canvas resize observer', () => {
  it('disconnects the previous observer when the UI is rebuilt', () => {
    observers.length = 0;
    const scene = sceneWithGridArea(800, 500);
    scene.setupCanvasResizeObserver();
    scene.setupCanvasResizeObserver(); // rebuildUI -> createUI -> initializeGrid
    assert.equal(observers.length, 2);
    assert.equal(observers[0].disconnected, true);
    assert.equal(observers[1].disconnected, false);
    assert.equal(scene.resizeObserver, observers[1]);
  });

  it('keeps a positive canvas size when the grid area is squeezed', () => {
    const scene = sceneWithGridArea(120, 30);
    scene.resizeCanvasForDPR();
    assert.ok(scene.logicalWidth > 0 && scene.logicalHeight > 0);
    assert.ok(scene.gridCanvas.width > 0 && scene.gridCanvas.height > 0);
  });
});
