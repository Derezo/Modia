import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0, onLine: true }
});
globalThis.document = {
  createElement() {
    return {
      id: '',
      textContent: '',
      style: {},
      classList: { add() {}, remove() {} }
    };
  },
  getElementById() { return null; },
  head: { appendChild() {} },
  body: { appendChild() {} }
};

const frontendRoot = fileURLToPath(new URL('../../../', import.meta.url));
const vite = await createServer({
  root: frontendRoot,
  configFile: fileURLToPath(new URL('../../../vite.config.js', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom'
});
after(async () => vite.close());

const { BattleScene } =
  await vite.ssrLoadModule('/src/scenes/BattleScene.js');
const { BattleMapSession } =
  await vite.ssrLoadModule('/src/battle/BattleMapSession.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('BattleScene async lifecycle', () => {
  it('returns false when exit invalidates a pending hydration', async () => {
    const hydration = deferred();
    const originalHydrateResponse = BattleMapSession.prototype.hydrateResponse;
    BattleMapSession.prototype.hydrateResponse = () => hydration.promise;

    try {
      const scene = new BattleScene({});
      const entering = scene.enter({ battleId: 1 });
      const pendingEpoch = scene.entryEpoch;

      scene.exit();
      assert.ok(scene.entryEpoch > pendingEpoch);

      hydration.resolve({
        battleId: 1,
        state: { status: 'active', units: [] }
      });

      assert.equal(await entering, false);
      assert.equal(scene.grid, null);
    } finally {
      BattleMapSession.prototype.hydrateResponse = originalHydrateResponse;
    }
  });

  it('swallows a stale hydration rejection after exit', async () => {
    const hydration = deferred();
    const originalHydrateResponse = BattleMapSession.prototype.hydrateResponse;
    BattleMapSession.prototype.hydrateResponse = () => hydration.promise;

    try {
      const scene = new BattleScene({});
      const entering = scene.enter({ battleId: 2 });

      scene.exit();
      hydration.reject(new Error('late hydration failure'));

      assert.equal(await entering, false);
      assert.equal(scene.grid, null);
    } finally {
      BattleMapSession.prototype.hydrateResponse = originalHydrateResponse;
    }
  });

  it('does not finish input setup when exit occurs during asset preloading', async () => {
    const terrainPreload = deferred();
    const preloadStarted = deferred();
    const game = {
      canvas: { width: 800, height: 600 },
      targetWidth: 800,
      targetHeight: 600,
      state: { get() { return null; } },
      assetLoader: {
        preloadTerrainSet() {
          preloadStarted.resolve();
          return terrainPreload.promise;
        },
        preloadObstacles() {
          return Promise.resolve();
        }
      }
    };
    const scene = new BattleScene(game);
    const entering = scene.enter({
      battleId: 3,
      mapSeed: 123,
      mapWidth: 10,
      mapHeight: 10,
      nodeType: 'forest',
      state: { status: 'active', units: [] }
    });

    await Promise.race([
      preloadStarted.promise,
      entering.then(result => {
        throw new Error(`Battle entry settled before preloading: ${result}`);
      })
    ]);
    assert.ok(scene.grid);

    scene.exit();
    terrainPreload.resolve();

    assert.equal(await entering, false);
    assert.equal(scene.grid, null);
    assert.equal(scene.inputHandler, null);
    assert.equal(scene.camera, null);
  });
});
