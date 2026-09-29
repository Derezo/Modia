/**
 * WorldMapScene.enter() must not build DOM, listeners or the HUD canvas when
 * exit() ran while one of its awaits was pending (SceneManager does not await
 * enter()). Lives beside the worldmap modules because it covers the world map
 * scene's entry flow.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let WorldMapScene;

/** A permissive fake: any property read returns a callable fake. */
function fake(overrides = {}) {
  const target = function fakeFn() { return fake(); };
  Object.assign(target, overrides);
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined;
      return fake();
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
    apply() {
      return fake();
    }
  });
}

before(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: { search: '', hostname: 'localhost' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.document = {
    createElement: () => fake({ style: {}, dataset: {} }),
    createElementNS: () => fake({ style: {}, dataset: {} }),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    head: { appendChild() {} },
    body: { appendChild() {} }
  };

  server = await createServer({
    configFile: './vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({ WorldMapScene } = await server.ssrLoadModule('/src/scenes/WorldMapScene.js'));
});

after(async () => {
  await server?.close();
});

describe('WorldMapScene.enter session epoch', () => {
  it('stops building UI when exit() runs while world data is loading', async () => {
    const overlayChildren = [];
    const canvasParentChildren = [];
    const scene = Object.create(WorldMapScene.prototype);
    scene.sceneSessionEpoch = 0;
    scene.nodeSpacing = 60;
    scene.game = {
      assetLoader: null,
      state: { get: key => (key === 'user' ? { id: 7 } : null), set() {} },
      canvas: fake({
        width: 1280,
        height: 720,
        parentElement: fake({ appendChild: child => canvasParentChildren.push(child) })
      }),
      uiOverlay: { appendChild: child => overlayChildren.push(child) }
    };

    let resolveWorld;
    let setupWebSocketCalls = 0;
    let inputSetupCalls = 0;
    scene.loadWorldData = () => new Promise(resolve => { resolveWorld = resolve; });
    scene.loadRegionData = async () => {};
    scene.createUI = () => overlayChildren.push('ui');
    scene.centerOnCurrentNode = () => {};
    scene.inputHandler = { setup: () => { inputSetupCalls += 1; } };
    scene.setupWebSocketHandlers = () => { setupWebSocketCalls += 1; };
    scene.createHUDCanvas = () => canvasParentChildren.push('hud-canvas');

    const entering = scene.enter();
    // Let effects.init resolve and loadWorldData start.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(typeof resolveWorld, 'function', 'enter reached loadWorldData');

    // Simulate SceneManager switching away mid-load.
    scene.sceneSessionEpoch += 1;
    resolveWorld(true);
    await entering;

    assert.equal(overlayChildren.length, 0, 'no overlay UI was appended');
    // (The fog overlay built before the pending await is exit()'s to destroy.)
    assert.equal(canvasParentChildren.includes('hud-canvas'), false, 'no #hud-canvas was added');
    assert.equal(setupWebSocketCalls, 0, 'no ws handlers were registered');
    assert.equal(inputSetupCalls, 0, 'no input listeners were registered');
  });
});
