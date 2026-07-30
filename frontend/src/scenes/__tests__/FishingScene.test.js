import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { ApiClient } from '../../api/client.js';

let server;
let FishingScene;
let parchmentToast;

before(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = {
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      addEventListener() {},
      remove() {}
    }),
    getElementById: () => null,
    head: { appendChild() {} },
    body: { appendChild() {} }
  };

  server = await createServer({
    configFile: './vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom'
  });

  ({ FishingScene } = await server.ssrLoadModule('/src/scenes/FishingScene.js'));
  ({ parchmentToast } = await server.ssrLoadModule('/src/ui/parchment/ParchmentToast.js'));
});

after(async () => {
  await server?.close();
});

function createScene(fields = {}) {
  return Object.assign(Object.create(FishingScene.prototype), {
    nodeId: 42,
    nodeName: 'Quiet Pond',
    sessionId: null,
    sessionLifecycle: 1,
    endInFlight: null,
    isActive: false,
    catches: [],
    totalValue: 0,
    sessionStartTime: null,
    catchTimer: null,
    updateInterval: null,
    bigOneTimer: null,
    bigOneActive: false,
    bigOneExpires: null,
    bigOneFish: null,
    config: {},
    uiElement: null,
    ...fields
  });
}

describe('ApiClient fishing session identity', () => {
  it('sends the session ID with every session mutation and exposes active status', async () => {
    const client = new ApiClient('/api');
    const requests = [];
    client.post = async (endpoint, body) => requests.push({ method: 'POST', endpoint, body });
    client.get = async endpoint => requests.push({ method: 'GET', endpoint });

    await client.registerCatch(42, 'session-7');
    await client.claimBigOne(42, 'session-7');
    await client.endFishing(42, 'session-7');
    await client.getActiveFishingStatus();

    assert.deepEqual(requests, [
      {
        method: 'POST',
        endpoint: '/fishing/42/catch',
        body: { sessionId: 'session-7' }
      },
      {
        method: 'POST',
        endpoint: '/fishing/42/big-one',
        body: { sessionId: 'session-7' }
      },
      {
        method: 'POST',
        endpoint: '/fishing/42/end',
        body: { sessionId: 'session-7' }
      },
      { method: 'GET', endpoint: '/fishing/status' }
    ]);
  });
});

describe('FishingScene session lifecycle', () => {
  it('clears singleton session data before a genuinely new entry', () => {
    const scene = createScene({
      isActive: true,
      sessionId: 'session-complete',
      catches: [{ fishName: 'Old Trout', value: 8 }],
      totalValue: 8,
      sessionStartTime: 1_700_000_000_000,
      nextCatchTime: 1_700_000_005_000,
      bigOneActive: true,
      bigOneExpires: 1_700_000_003_000,
      bigOneFish: { fishName: 'Old Carp' }
    });

    scene.resetLocalSession();

    assert.equal(scene.isActive, false);
    assert.equal(scene.sessionId, null);
    assert.deepEqual(scene.catches, []);
    assert.equal(scene.totalValue, 0);
    assert.equal(scene.sessionStartTime, null);
    assert.equal(scene.nextCatchTime, null);
    assert.equal(scene.bigOneActive, false);
    assert.equal(scene.bigOneExpires, null);
    assert.equal(scene.bigOneFish, null);
  });

  it('hydrates the authoritative active session, including catches and Big One', () => {
    const calls = {
      rendered: 0,
      stats: 0,
      scheduled: 0,
      disabled: [],
      bigOne: null
    };
    const statusElement = {
      classList: { remove() {} },
      innerHTML: ''
    };
    const scene = createScene({
      uiElement: {
        querySelector(selector) {
          return selector === '#fishing-status' ? statusElement : null;
        }
      },
      renderCatches() {
        calls.rendered += 1;
      },
      updateStats() {
        calls.stats += 1;
      },
      updateSessionTime() {},
      updateCatchCountdown() {},
      scheduleCatch() {
        calls.scheduled += 1;
      },
      setActionButtonsDisabled(disabled) {
        calls.disabled.push(disabled);
      },
      showBigOne(bigOne) {
        calls.bigOne = bigOne;
      }
    });
    const oldest = { fishName: 'Minnow', value: 2 };
    const newest = { fishName: 'Trout', value: 7 };
    const responseCatches = [oldest, newest];

    scene.hydrateSession({
      active: true,
      sessionId: 'session-restored',
      startTime: 1_700_000_000_000,
      catches: responseCatches,
      totalValue: 9,
      config: {
        minCatchInterval: 1000,
        maxCatchInterval: 2000,
        bigOneWindowMs: 3000
      },
      bigOne: {
        active: true,
        expiresIn: 2500,
        fishName: 'Golden Carp',
        rarity: 'legendary'
      }
    }, 1);

    clearInterval(scene.updateInterval);
    assert.equal(scene.isActive, true);
    assert.equal(scene.sessionId, 'session-restored');
    assert.equal(scene.sessionStartTime, 1_700_000_000_000);
    assert.equal(scene.totalValue, 9);
    assert.deepEqual(scene.catches, [newest, oldest]);
    assert.deepEqual(responseCatches, [oldest, newest]);
    assert.equal(scene.config.bigOneWindowMs, 3000);
    assert.equal(statusElement.innerHTML, '<span>Fishing...</span>');
    assert.equal(calls.rendered, 1);
    assert.equal(calls.stats, 1);
    assert.equal(calls.scheduled, 1);
    assert.deepEqual(calls.disabled, [false]);
    assert.equal(calls.bigOne.fishName, 'Golden Carp');
  });

  it('uses a restored startup session without starting or re-querying', async () => {
    const restored = {
      active: true,
      sessionId: 'session-startup',
      catches: [],
      totalValue: 0
    };
    let getStatusCalls = 0;
    let startCalls = 0;
    let hydrated;
    const scene = createScene({
      game: {
        api: {
          async getFishingStatus() {
            getStatusCalls += 1;
          },
          async startFishing() {
            startCalls += 1;
          }
        }
      },
      hydrateSession(result) {
        hydrated = result;
      }
    });
    parchmentToast.success = () => {};

    await scene.startFishing(1, restored);

    assert.equal(hydrated, restored);
    assert.equal(getStatusCalls, 0);
    assert.equal(startCalls, 0);
  });

  it('starts when status is inactive and hydrates an idempotently resumed response', async () => {
    const resumed = {
      active: true,
      resumed: true,
      sessionId: 'session-resumed',
      catches: [{ fishName: 'Perch', value: 4 }],
      totalValue: 4
    };
    let hydrated;
    const scene = createScene({
      game: {
        api: {
          async getFishingStatus() {
            return { active: false };
          },
          async startFishing() {
            return resumed;
          }
        }
      },
      hydrateSession(result) {
        hydrated = result;
      }
    });
    const successCalls = [];
    parchmentToast.success = (...args) => successCalls.push(args);

    await scene.startFishing(1);

    assert.equal(hydrated, resumed);
    assert.deepEqual(successCalls, [[
      'Fishing Restored',
      'Your fishing session has been restored.'
    ]]);
  });

  it('ignores a late catch response after the session begins ending', async () => {
    let resolveCatch;
    let request;
    let renderCalls = 0;
    let scheduleCalls = 0;
    const catchResponse = new Promise(resolve => {
      resolveCatch = resolve;
    });
    const scene = createScene({
      isActive: true,
      sessionId: 'session-old',
      game: {
        api: {
          registerCatch(nodeId, sessionId) {
            request = { nodeId, sessionId };
            return catchResponse;
          }
        },
        audio: {}
      },
      renderCatches() {
        renderCalls += 1;
      },
      updateStats() {},
      scheduleCatch() {
        scheduleCalls += 1;
      }
    });

    const catchRequest = scene.triggerCatch();
    scene.isActive = false;
    scene.sessionLifecycle += 1;
    resolveCatch({
      catch: { fishName: 'Stale Salmon', value: 50 },
      sessionStats: { totalValue: 50 }
    });
    await catchRequest;

    assert.deepEqual(request, { nodeId: 42, sessionId: 'session-old' });
    assert.deepEqual(scene.catches, []);
    assert.equal(scene.totalValue, 0);
    assert.equal(renderCalls, 0);
    assert.equal(scheduleCalls, 0);
  });

  it('guards duplicate collection and clears local state after success', async () => {
    let resolveEnd;
    let endCalls = 0;
    let switchCalls = 0;
    const disabledStates = [];
    const stateUpdates = [];
    const endResponse = new Promise(resolve => {
      resolveEnd = resolve;
    });
    const scene = createScene({
      isActive: true,
      sessionId: 'session-end',
      catches: [{ fishName: 'Bass', value: 6 }],
      totalValue: 6,
      game: {
        api: {
          endFishing(nodeId, sessionId) {
            endCalls += 1;
            assert.equal(nodeId, 42);
            assert.equal(sessionId, 'session-end');
            return endResponse;
          }
        },
        state: {
          get() {
            return { gold: 10 };
          },
          set(key, value) {
            stateUpdates.push([key, value]);
          }
        },
        scenes: {
          switchTo(sceneName) {
            assert.equal(sceneName, 'worldMap');
            switchCalls += 1;
          }
        }
      },
      stopTimers() {},
      setActionButtonsDisabled(disabled) {
        disabledStates.push(disabled);
      }
    });
    parchmentToast.success = () => {};

    const firstEnd = scene.endFishing();
    const secondEnd = scene.endFishing();

    assert.equal(scene.isActive, false);
    assert.equal(endCalls, 1);
    assert.deepEqual(disabledStates, [true]);

    resolveEnd({
      newGold: 16,
      message: 'Collected once'
    });
    await Promise.all([firstEnd, secondEnd]);

    assert.equal(switchCalls, 1);
    assert.equal(scene.sessionId, null);
    assert.deepEqual(scene.catches, []);
    assert.equal(scene.totalValue, 0);
    assert.equal(scene.endInFlight, null);
    assert.deepEqual(stateUpdates, [['user', { gold: 16 }]]);
  });

  it('does not let an old collection completion clear a re-entered session', async () => {
    let resolveEnd;
    let switchCalls = 0;
    const stateUpdates = [];
    const endResponse = new Promise(resolve => {
      resolveEnd = resolve;
    });
    const scene = createScene({
      isActive: true,
      sessionId: 'session-old',
      game: {
        api: {
          endFishing() {
            return endResponse;
          }
        },
        state: {
          get() {
            return { gold: 10 };
          },
          set(key, value) {
            stateUpdates.push([key, value]);
          }
        },
        scenes: {
          switchTo() {
            switchCalls += 1;
          }
        }
      },
      stopTimers() {},
      setActionButtonsDisabled() {}
    });

    const oldEnd = scene.endFishing();

    // Model a new enter while the old HTTP request is still pending.
    scene.endInFlight = null;
    scene.sessionLifecycle += 1;
    scene.sessionId = 'session-new';
    scene.isActive = true;
    scene.catches = [{ fishName: 'New Trout', value: 9 }];
    scene.totalValue = 9;

    resolveEnd({ newGold: 16, message: 'Old session collected' });
    await oldEnd;

    assert.equal(scene.sessionId, 'session-new');
    assert.equal(scene.isActive, true);
    assert.deepEqual(scene.catches, [{ fishName: 'New Trout', value: 9 }]);
    assert.equal(scene.totalValue, 9);
    assert.equal(switchCalls, 0);
    assert.deepEqual(stateUpdates, []);
  });

  it('rebuilds an unexpired Big One overlay after a breakpoint change', () => {
    const oldTimer = setInterval(() => {}, 1000);
    const shown = [];
    const scene = createScene({
      isActive: true,
      uiElement: { remove() {} },
      catches: [{ fishName: 'Bass', value: 6 }],
      totalValue: 6,
      bigOneActive: true,
      bigOneExpires: Date.now() + 3000,
      bigOneFish: {
        fishName: 'Golden Carp',
        rarity: 'legendary'
      },
      bigOneTimer: oldTimer,
      createUI() {
        this.uiElement = {};
      },
      setupEventListeners() {},
      renderCatches() {},
      updateStats() {},
      setActionButtonsDisabled() {},
      showBigOne(bigOne, playSound) {
        shown.push({ bigOne, playSound });
      }
    });

    scene.onBreakpointChange();

    assert.equal(scene.bigOneTimer, null);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].bigOne.fishName, 'Golden Carp');
    assert.ok(shown[0].bigOne.expiresIn > 0);
    assert.equal(shown[0].playSound, false);
  });
});
