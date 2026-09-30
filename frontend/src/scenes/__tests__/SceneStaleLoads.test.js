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
  matchMedia() { return { matches: false }; }
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

const { MarketplaceScene } = await vite.ssrLoadModule('/src/scenes/MarketplaceScene.js');
const { RecruitmentScene } = await vite.ssrLoadModule('/src/scenes/RecruitmentScene.js');
const { parchmentToast } = await vite.ssrLoadModule('/src/ui/parchment/ParchmentToast.js');

const toasts = [];
parchmentToast.error = (title) => { toasts.push(title); };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('MarketplaceScene loads after exit', () => {
  function marketplace(api) {
    const scene = Object.create(MarketplaceScene.prototype);
    Object.assign(scene, {
      game: { api },
      uiElement: { querySelector: () => null, querySelectorAll: () => [] },
      activeTab: 'search',
      itemPanel: null
    });
    return scene;
  }

  it('drops initial data (and shows no error toast) when the player left first', async () => {
    const pending = deferred();
    const scene = marketplace({
      searchMarketItems: () => pending.promise,
      getMyOrders: async () => ({ orders: [] }),
      getMyListings: async () => ({ listings: [] }),
      getSellableInventory: async () => ({ items: [] })
    });
    let rendered = 0;
    scene.renderContent = () => { rendered++; };
    toasts.length = 0;

    const loading = scene.loadInitialData();
    scene.uiElement = null; // exit()
    pending.resolve({ items: [{ id: 1 }] });
    await loading;

    assert.equal(rendered, 0);
    assert.deepEqual(toasts, []);
  });

  it('does not toast a failure for a load that belonged to an exited scene', async () => {
    const pending = deferred();
    const scene = marketplace({
      searchMarketItems: () => pending.promise,
      getMyOrders: async () => ({ orders: [] }),
      getMyListings: async () => ({ listings: [] }),
      getSellableInventory: async () => ({ items: [] })
    });
    toasts.length = 0;
    const loading = scene.loadInitialData();
    scene.uiElement = null;
    pending.reject(new Error('aborted'));
    await loading;
    assert.deepEqual(toasts, []);
  });

  it('renderContent is a no-op without a UI', () => {
    const scene = marketplace({});
    scene.uiElement = null;
    assert.doesNotThrow(() => scene.renderContent());
  });

  it('drops my orders and listings that arrive after exit', async () => {
    const orders = deferred();
    const listings = deferred();
    const scene = marketplace({ getMyOrders: () => orders.promise, getMyListings: () => listings.promise });
    let rendered = 0;
    scene.renderContent = () => { rendered++; };
    const a = scene.loadMyOrders();
    const b = scene.loadMyListings();
    scene.uiElement = null;
    orders.resolve({ orders: [{ id: 1 }] });
    listings.resolve({ listings: [{ id: 2 }] });
    await Promise.all([a, b]);
    assert.equal(rendered, 0);
    assert.equal(scene.myOrders, undefined);
  });
});

describe('RecruitmentScene enter/exit during load', () => {
  it('does not start the countdown interval when exit() ran during the load', async () => {
    const pending = deferred();
    const scene = new RecruitmentScene({
      state: { get: () => ({ gold: 0 }) },
      api: { getGuildInfo: () => pending.promise, getGuildRecruits: () => pending.promise },
      scenes: { switchTo: noop },
      uiOverlay: { appendChild: noop },
      musicContext: null
    });
    scene.addStyles = noop;
    scene.createUI = function createUI() { this.uiElement = { remove: noop, querySelector: () => null }; };
    scene.setupEventListeners = noop;
    let started = 0;
    scene.startCountdownTimer = () => { started++; };

    const entering = scene.enter({ nodeId: 5, guildClass: 'warrior' });
    scene.exit();
    pending.resolve({ recruits: [] });
    await entering;

    assert.equal(started, 0);
    assert.equal(scene.countdownInterval, null);
  });

  it('replaces rather than stacks the countdown interval', () => {
    const scene = Object.create(RecruitmentScene.prototype);
    scene.guildInfo = null;
    scene.countdownInterval = null;
    scene.startCountdownTimer();
    const first = scene.countdownInterval;
    scene.startCountdownTimer();
    assert.notEqual(scene.countdownInterval, first);
    clearInterval(scene.countdownInterval);
    // The first handle was cleared by the second start: nothing else to clean up
  });
});
