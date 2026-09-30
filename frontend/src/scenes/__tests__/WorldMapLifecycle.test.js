import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const noop = () => {};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia() { return { matches: false }; },
  location: { search: '' }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0, onLine: true }
});
globalThis.document = {
  createElement() {
    return { id: '', textContent: '', style: {}, classList: { add: noop, remove: noop } };
  },
  getElementById() { return null; },
  head: { appendChild: noop },
  body: { appendChild: noop }
};

const frontendRoot = fileURLToPath(new URL('../../../', import.meta.url));
const vite = await createServer({
  root: frontendRoot,
  configFile: fileURLToPath(new URL('../../../vite.config.js', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom'
});
after(async () => vite.close());

const { WorldMapScene } = await vite.ssrLoadModule('/src/scenes/WorldMapScene.js');
const { WorldMapEffects } = await vite.ssrLoadModule('/src/worldmap/WorldMapEffects.js');
const { DOMFogOverlay } = await vite.ssrLoadModule('/src/worldmap/DOMFogOverlay.js');

// Effects and fog need a real canvas/DOM; they are not what this test checks
WorldMapEffects.prototype.init = async () => {};
DOMFogOverlay.prototype.init = noop;
DOMFogOverlay.prototype.setCanvasDimensions = noop;
DOMFogOverlay.prototype.setNodeSpacing = noop;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('WorldMapScene enter() superseded by exit()', () => {
  it('creates no UI, overlays, HUD canvas or socket handlers after exit', async () => {
    const worldData = deferred();
    const created = [];
    const appended = [];
    const scene = Object.create(WorldMapScene.prototype);
    Object.assign(scene, {
      game: {
        state: { get: (k) => (k === 'user' ? { id: 1 } : null) },
        canvas: {},
        targetWidth: 1280,
        targetHeight: 720,
        assetLoader: null,
        uiOverlay: { appendChild: (el) => appended.push(el) }
      },
      sceneSessionEpoch: 0,
      nodeSpacing: 1,
      inputHandler: { setup: () => created.push('input') }
    });
    scene.loadWorldData = () => worldData.promise;
    scene.loadRegionData = async () => created.push('regions');
    scene.createUI = () => created.push('ui');
    scene.centerOnCurrentNode = () => created.push('center');
    scene.setupWebSocketHandlers = () => created.push('ws');
    scene.createHUDCanvas = () => created.push('hud-canvas');

    const entering = scene.enter();
    await new Promise(resolve => setTimeout(resolve, 0)); // reach loadWorldData
    scene.sceneSessionEpoch++; // what exit() does first
    worldData.resolve(true);
    await entering;

    assert.deepEqual(created, []);
    assert.deepEqual(appended, []);
    assert.equal(scene.hudPanel, undefined);
  });
});
