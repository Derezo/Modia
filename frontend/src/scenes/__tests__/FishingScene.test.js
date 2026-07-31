import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { FishingState } from '../fishing/FishingState.js';
import { FishingController } from '../fishing/FishingController.js';
import { FishingRenderer } from '../fishing/FishingRenderer.js';

let server;
let FishingScene;
let FishingUI;
let parchmentToast;

before(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    }),
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
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    configFile: fileURLToPath(new URL('../../../vite.config.js', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({ FishingScene } = await server.ssrLoadModule('/src/scenes/FishingScene.js'));
  ({ FishingUI } = await server.ssrLoadModule('/src/scenes/fishing/FishingUI.js'));
  ({ parchmentToast } = await server.ssrLoadModule('/src/ui/parchment/ParchmentToast.js'));
});

after(async () => {
  await server?.close();
});

function commonState(overrides = {}) {
  return {
    serverTime: 1_700_000_000_000,
    active: true,
    session: {
      active: true,
      sessionId: 'session-1',
      nodeId: 42,
      nodeName: 'Quiet Pond',
      startTime: 1_699_999_000_000,
      expiresAt: 1_700_000_800_000,
      basket: {
        value: 17,
        catches: [{ fishName: 'Bass', rarity: 'common', value: 3 }]
      }
    },
    selectedRod: {
      catalogKey: 'weathered_rod',
      name: 'Weathered Rod',
      bigCatchRate: 0.1
    },
    ownedRods: [{ catalogKey: 'weathered_rod', name: 'Weathered Rod' }],
    ownedTackle: [{ catalogKey: 'earthworm', name: 'Earthworm', count: 3 }],
    publicFish: [{ name: 'Bass', rarity: 'common' }],
    ...overrides
  };
}

function bigCatchEscapeResponse(overrides = {}) {
  return commonState({
    message: 'The Big Catch broke free. No fallback fish was awarded.',
    attempt: {
      attemptId: 'attempt-big-escape',
      phase: 'resolved',
      revision: 9,
      reel: {
        cues: ['left', 'up', 'right', 'down'],
        nextCueIndex: 4,
        hits: 4,
        misses: 0,
        requiredHits: 4
      },
      outcome: {
        result: 'big_catch_escaped',
        awarded: false,
        isBigCatch: true,
        rodKey: 'runebound_rod',
        landingRate: 0.85,
        resolvedAt: 1_700_000_000_000
      }
    },
    ...overrides
  });
}

describe('FishingState authoritative hydration', () => {
  it('hydrates basket, gear, catalog, server clock, and a reconnectable bite deadline', () => {
    let now = 1_699_999_999_500;
    const state = new FishingState(() => now);
    const snapshot = state.apply(commonState({
      attempt: {
        attemptId: 'attempt-1',
        phase: 'wait',
        revision: 4,
        biteAt: 1_700_000_000_000,
        hookDeadline: 1_700_000_003_000
      }
    }));

    assert.equal(snapshot.sessionId, 'session-1');
    assert.equal(snapshot.phase, 'bite');
    assert.equal(snapshot.basket.value, 17);
    assert.equal(snapshot.selectedRod.catalogKey, 'weathered_rod');
    assert.deepEqual(snapshot.publicFish, [{ name: 'Bass', rarity: 'common' }]);
    assert.equal(snapshot.remainingMs, 3000);

    now += 1500;
    assert.equal(state.remainingMs(), 1500);
  });

  it('restores reel cues without exposing or inventing a catch outcome', () => {
    const state = new FishingState(() => 1_700_000_000_000);
    const snapshot = state.apply(commonState({
      attempt: {
        attemptId: 'attempt-2',
        phase: 'reeling',
        revision: 7,
        reelDeadline: 1_700_000_006_000,
        reel: {
          cues: ['left', 'up', 'right'],
          requiredHits: 2,
          cueWindowMs: 2000,
          nextCueIndex: 1,
          hits: 1,
          startedAt: 1_699_999_997_500
        }
      }
    }));

    assert.equal(snapshot.phase, 'reel');
    assert.equal(snapshot.attempt.cues[1].direction, 'up');
    assert.equal(snapshot.attempt.requiredHits, 2);
    assert.equal(snapshot.currentCueIndex, 1);
    assert.equal(snapshot.lastResult, null);
  });

  it('does not expose the next tension cue before its server window starts', () => {
    const state = new FishingState(() => 1_700_000_000_000);
    const snapshot = state.apply(commonState({
      attempt: {
        attemptId: 'attempt-answered',
        phase: 'reel',
        revision: 4,
        reelDeadline: 1_700_000_004_000,
        reel: {
          cues: ['left', 'up', 'right'],
          requiredHits: 2,
          cueWindowMs: 2000,
          nextCueIndex: 1,
          hits: 1,
          startedAt: 1_699_999_999_000
        }
      }
    }));

    assert.equal(snapshot.currentCueIndex, null);
  });

  it('persists explicit no-fish feedback when a fully reeled Big Catch escapes', () => {
    const state = new FishingState(() => 1_700_000_000_000);
    const snapshot = state.apply(bigCatchEscapeResponse());

    assert.equal(snapshot.attempt.hits, 4);
    assert.equal(snapshot.attempt.requiredHits, 4);
    assert.equal(snapshot.terminalResult.kind, 'big_catch_escaped');
    assert.equal(snapshot.terminalResult.title, 'Big Catch Escaped');
    assert.equal(snapshot.terminalResult.noCatch, true);
    assert.match(snapshot.resultMessage, /No fish was added to your basket/i);
    assert.match(snapshot.resultMessage, /no fallback fish/i);

    const repeated = state.apply({ serverTime: 1_700_000_000_100 });
    assert.equal(repeated.resultMessage, snapshot.resultMessage);
  });

  it('reconstructs terminal feedback from the immutable outcome after reconnect', () => {
    const reconnectState = new FishingState(() => 1_700_000_000_000);
    const response = bigCatchEscapeResponse();
    delete response.message;

    const restored = reconnectState.apply(response);

    assert.equal(restored.terminalResult.identity, 'attempt-big-escape:big_catch_escaped');
    assert.match(restored.resultMessage, /Big Catch broke free/i);
    assert.match(restored.resultMessage, /No fish was added/i);

    const nextAttempt = reconnectState.apply(commonState({
      attempt: {
        attemptId: 'attempt-next',
        phase: 'cast',
        revision: 1
      }
    }));
    assert.equal(nextAttempt.terminalResult, null);
    assert.equal(nextAttempt.resultMessage, null);
  });
});

describe('FishingController action receipts and controls', () => {
  it('hydrates setup plus status without starting a second restored session', async () => {
    let starts = 0;
    const changes = [];
    const api = {
      async getFishingSetup() {
        return commonState({ session: undefined, active: false });
      },
      async getFishingStatus() {
        return commonState({
          attempt: { attemptId: 'attempt-wait', phase: 'wait', revision: 1 }
        });
      },
      async startFishing() {
        starts += 1;
      }
    };
    const controller = new FishingController({
      api,
      nodeId: 42,
      now: () => 1_700_000_000_000,
      onChange: state => changes.push(state.phase)
    });

    const state = await controller.initialize();

    assert.equal(starts, 0);
    assert.equal(state.phase, 'wait');
    assert.deepEqual(changes, ['idle', 'wait']);
  });

  it('restores an expired basket for packing without starting another session', async () => {
    let starts = 0;
    const expired = commonState({
      active: false,
      collectable: true,
      session: {
        active: false,
        expired: true,
        status: 'expired',
        sessionId: 'session-expired',
        nodeId: 42,
        nodeName: 'Quiet Pond',
        startTime: 1_699_998_000_000,
        expiresAt: 1_699_999_800_000,
        catches: [{ fishName: 'Bass', rarity: 'common', value: 3 }],
        totalValue: 3
      }
    });
    const api = {
      async getFishingSetup() {
        return expired;
      },
      async getFishingStatus() {
        throw new Error('initial collectable status should be reused');
      },
      async startFishing() {
        starts += 1;
      }
    };
    const controller = new FishingController({
      api,
      nodeId: 42,
      now: () => 1_700_000_000_000
    });

    const state = await controller.initialize(expired);

    assert.equal(starts, 0);
    assert.equal(state.active, false);
    assert.equal(state.sessionId, 'session-expired');
    assert.equal(state.basket.value, 3);
  });

  it('reuses the release action ID after an ambiguous response', async () => {
    const releaseIds = [];
    let releaseCalls = 0;
    const api = {
      async beginFishingCast(_nodeId, sessionId, _actionId) {
        assert.equal(sessionId, 'session-1');
        return commonState({
          attempt: { attemptId: 'attempt-retry', phase: 'cast', revision: 1 }
        });
      },
      async releaseFishingCast(_nodeId, sessionId, _attemptId, actionId) {
        assert.equal(sessionId, 'session-1');
        releaseIds.push(actionId);
        releaseCalls += 1;
        if (releaseCalls === 1) {
          const error = new Error('lost response');
          error.isNetworkError = true;
          throw error;
        }
        return commonState({
          attempt: { attemptId: 'attempt-retry', phase: 'wait', revision: 2 }
        });
      }
    };
    const controller = new FishingController({
      api,
      nodeId: 42,
      onError() {}
    });
    controller.state.apply(commonState());

    await controller.beginCast();
    await assert.rejects(controller.releaseCast(), /lost response/);
    await controller.releaseCast();

    assert.equal(releaseIds.length, 2);
    assert.equal(releaseIds[0], releaseIds[1]);
    assert.equal(controller.state.phase(), 'wait');
  });

  it('submits non-color directional cue input and leaves resolution to the scene', async () => {
    const calls = [];
    const api = {
      async reelFishingCast(_nodeId, sessionId, attemptId, direction, cueIndex, actionId) {
        assert.equal(sessionId, 'session-1');
        calls.push({ type: 'reel', attemptId, direction, cueIndex, actionId });
        return commonState({
          attempt: {
            attemptId,
            phase: 'resolve',
            revision: 5,
            canResolve: true
          }
        });
      }
    };
    const controller = new FishingController({ api, nodeId: 42 });
    controller.state.apply(commonState({
      attempt: {
        attemptId: 'attempt-cue',
        phase: 'reel',
        revision: 4,
        cues: ['left'],
        requiredHits: 1
      }
    }));

    await controller.reel('LEFT', 0);

    assert.deepEqual(calls.map(call => [call.type, call.direction, call.cueIndex]), [
      ['reel', 'left', 0]
    ]);
    assert.equal(controller.state.phase(), 'resolve');
  });

  it('reuses a resolve action ID after an ambiguous response', async () => {
    const actionIds = [];
    const reportedActions = [];
    let calls = 0;
    const api = {
      async resolveFishingCast(_nodeId, sessionId, attemptId, actionId) {
        assert.equal(sessionId, 'session-1');
        assert.equal(attemptId, 'attempt-resolve-retry');
        actionIds.push(actionId);
        calls += 1;
        if (calls === 1) {
          const error = new Error('lost resolve response');
          error.isTimeout = true;
          throw error;
        }
        return commonState({
          attempt: {
            attemptId,
            phase: 'resolved',
            revision: 9,
            outcome: {
              result: 'caught',
              awarded: true,
              catch: { fishName: 'Bass', value: 3 }
            }
          }
        });
      }
    };
    const controller = new FishingController({
      api,
      nodeId: 42,
      onError(_error, action) {
        reportedActions.push(action);
      }
    });
    controller.state.apply(commonState({
      attempt: {
        attemptId: 'attempt-resolve-retry',
        phase: 'resolve',
        revision: 8
      }
    }));

    await assert.rejects(controller.resolve(), /lost resolve response/);
    await controller.resolve();

    assert.equal(actionIds.length, 2);
    assert.equal(actionIds[0], actionIds[1]);
    assert.deepEqual(reportedActions, [{
      key: 'resolve:attempt-resolve-retry',
      actionId: actionIds[0]
    }]);
    assert.equal(controller.state.phase(), 'resolved');
  });
});

describe('FishingUI terminal result feedback', () => {
  function element(overrides = {}) {
    return {
      dataset: {},
      style: {},
      hidden: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      value: '',
      ...overrides
    };
  }

  function uiHarness() {
    const elements = {
      '#fishing-phase': element(),
      '#fishing-session-time': element(),
      '#fishing-cast-button': element(),
      '#fishing-hook-button': element(),
      '#fishing-cues': element(),
      '#fishing-instruction': element(),
      '#fishing-result': element(),
      '#fishing-result-title': element(),
      '#fishing-result-message': element(),
      '#fishing-rod-select': element(),
      '#fishing-tackle-select': element(),
      '#fishing-power-fill': element(),
      '#fishing-countdown-fill': element()
    };
    const ui = new FishingUI({ overlay: null, nodeName: 'Quiet Pond' });
    ui.root = {
      querySelector: selector => elements[selector],
      remove() {}
    };
    ui.renderGear = () => {};
    ui.renderCatalog = () => {};
    ui.renderBasket = () => {};
    return { ui, elements };
  }

  it('shows an accessible no-fish banner after a successful reel loses the rod roll', () => {
    const state = new FishingState(() => 1_700_000_000_000);
    const snapshot = state.apply(bigCatchEscapeResponse());
    const { ui, elements } = uiHarness();

    ui.render(snapshot);

    assert.equal(elements['#fishing-result'].hidden, false);
    assert.equal(elements['#fishing-result'].dataset.outcome, 'big_catch_escaped');
    assert.equal(elements['#fishing-result-title'].textContent, 'Big Catch Escaped');
    assert.match(elements['#fishing-result-message'].textContent, /No fish was added/i);
    assert.equal(
      elements['#fishing-instruction'].textContent,
      'Cast again when ready.'
    );
    assert.match(FishingUI.prototype.mount.toString(), /role="status"/);
    assert.match(FishingUI.prototype.mount.toString(), /aria-live="polite"/);
  });

  it('hides stale terminal feedback when a new cast begins', () => {
    const state = new FishingState(() => 1_700_000_000_000);
    state.apply(bigCatchEscapeResponse());
    const active = state.apply(commonState({
      attempt: {
        attemptId: 'attempt-new-cast',
        phase: 'cast',
        revision: 1,
        castStartedAt: 1_700_000_000_000
      }
    }));
    const { ui, elements } = uiHarness();

    ui.render(active);

    assert.equal(elements['#fishing-result'].hidden, true);
    assert.equal(elements['#fishing-result-title'].textContent, '');
    assert.equal(elements['#fishing-result-message'].textContent, '');
  });
});

describe('FishingRenderer fallback and motion safety', () => {
  function createContext() {
    const calls = [];
    const gradient = { addColorStop(offset, color) { calls.push(['stop', offset, color]); } };
    return {
      calls,
      save() {},
      restore() {},
      translate(x, y) { calls.push(['translate', x, y]); },
      createLinearGradient() { return gradient; },
      drawImage(...args) { calls.push(['drawImage', ...args]); },
      fillRect(...args) { calls.push(['fillRect', ...args]); },
      beginPath() { calls.push(['beginPath']); },
      moveTo(...args) { calls.push(['moveTo', ...args]); },
      lineTo(...args) { calls.push(['lineTo', ...args]); },
      quadraticCurveTo(...args) { calls.push(['quadraticCurveTo', ...args]); },
      stroke() { calls.push(['stroke']); },
      arc(...args) { calls.push(['arc', ...args]); },
      ellipse(...args) { calls.push(['ellipse', ...args]); },
      fill() { calls.push(['fill']); },
      set fillStyle(_value) {},
      set strokeStyle(_value) {},
      set lineWidth(_value) {},
      set lineCap(_value) {}
    };
  }

  function installImageMock() {
    const originalImage = globalThis.Image;
    const images = [];
    globalThis.Image = class MockImage {
      constructor() {
        this.naturalWidth = 512;
        this.naturalHeight = 512;
        this.onload = null;
        this.onerror = null;
        images.push(this);
      }

      set src(value) {
        this._src = value;
      }

      get src() {
        return this._src;
      }
    };
    return {
      images,
      restore() {
        if (originalImage === undefined) delete globalThis.Image;
        else globalThis.Image = originalImage;
      }
    };
  }

  it('draws a biome gradient when artwork is absent', () => {
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => 1000 });
    renderer.setState({ biome: 'Shadowmere', backgroundPath: null, phase: 'idle' });
    const context = createContext();

    renderer.render(context, 800, 600);

    assert.ok(context.calls.some(call => call[0] === 'fillRect'));
    assert.ok(context.calls.some(call => call[0] === 'stop' && call[2] === '#343352'));
  });

  it('suppresses Big Catch shake when reduced motion is requested', () => {
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => 1000 });
    renderer.setState({ biome: 'Heartlands', phase: 'caught' });
    renderer.triggerSuccess(true);
    const context = createContext();

    renderer.render(context, 800, 600);

    assert.deepEqual(
      context.calls.find(call => call[0] === 'translate'),
      ['translate', 0, 0]
    );
  });

  it('loads each selected rod from its approved original asset and caches prior selections', () => {
    const imageMock = installImageMock();
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => 1000 });
    const selections = [
      [{ key: 'fishing:rod:weathered' }, 'fishing_rod_weathered'],
      [{ spriteId: 'fishing_rod_riverwood' }, 'fishing_rod_riverwood'],
      [{ catalogKey: 'silverline_rod' }, 'fishing_rod_silverline'],
      [{ catalog_key: 'fishing:rod:runebound' }, 'fishing_rod_runebound']
    ];

    try {
      for (const [selectedRod, spriteId] of selections) {
        renderer.setState({ selectedRod, phase: 'idle' });
        assert.equal(
          imageMock.images.at(-1).src,
          `/assets/items/originals/consumables/${spriteId}.webp`
        );
      }
      assert.equal(imageMock.images.length, 4);

      renderer.setState({ selectedRod: selections[0][0], phase: 'idle' });
      assert.equal(imageMock.images.length, 4);
      assert.equal(renderer.rodPath, '/assets/items/originals/consumables/fishing_rod_weathered.webp');
    } finally {
      renderer.destroy();
      imageMock.restore();
    }
  });

  it('draws the high-resolution rod and starts the line at its exact rendered tip', () => {
    const imageMock = installImageMock();
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => 1000 });

    try {
      renderer.setState({
        selectedRod: { spriteId: 'fishing_rod_weathered' },
        phase: 'wait',
        attempt: { castPower: 50 }
      });
      imageMock.images[0].onload();
      const context = createContext();

      renderer.render(context, 800, 600);

      const drawCall = context.calls.find(call => call[0] === 'drawImage');
      assert.ok(drawCall);
      assert.equal(drawCall[1], imageMock.images[0]);
      const expectedTip = [
        drawCall[2] + (drawCall[4] * (473 / 512)),
        drawCall[3] + (drawCall[5] * (42 / 512))
      ];
      assert.equal(drawCall[4], drawCall[5]);
      assert.deepEqual(expectedTip, [
        (800 * 0.37) - (drawCall[4] * 0.15),
        600 * 0.22
      ]);
      assert.ok(Math.abs(expectedTip[0] - 240.2) < Number.EPSILON * 240.2);
      const curveIndex = context.calls.findIndex(call => call[0] === 'quadraticCurveTo');
      assert.ok(curveIndex > 0);
      assert.deepEqual(context.calls[curveIndex - 1], ['moveTo', ...expectedTip]);
    } finally {
      renderer.destroy();
      imageMock.restore();
    }
  });

  it('places a released bobber using authoritative cast power instead of elapsed cast time', () => {
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => 10_000 });
    renderer.setState({
      selectedRod: { key: 'fishing:rod:weathered' },
      phase: 'wait',
      serverNow: 10_000,
      attempt: {
        castPower: 25,
        timestamps: { castStartedAt: 1_000 }
      }
    });
    const context = createContext();

    renderer.render(context, 800, 600);

    const bodyArc = context.calls.find(call => call[0] === 'arc' && call[3] === 10);
    assert.ok(bodyArc);
    assert.equal(bodyArc[1], 800 * (0.46 + (0.25 * 0.26)));
  });

  it('draws a detailed bite bobber with sections, eyelet, reflection, ripples, and pulse', () => {
    const renderer = new FishingRenderer({ reducedMotion: false, now: () => 2_400 });
    renderer.setState({
      selectedRod: { key: 'fishing:rod:weathered' },
      phase: 'bite',
      attempt: { castPower: 60 }
    });
    const context = createContext();

    renderer.render(context, 800, 600);

    assert.ok(context.calls.filter(call => call[0] === 'arc' && call[3] === 10).length >= 3);
    assert.ok(context.calls.some(call => call[0] === 'arc' && call[3] === 3.2));
    assert.ok(context.calls.some(call => call[0] === 'arc' && call[3] > 16));
    assert.ok(context.calls.filter(call => call[0] === 'ellipse').length >= 3);
    assert.ok(context.calls.some(call => (
      call[0] === 'fillRect' && call[4] === 4
    )));

    const eyelet = context.calls.find(call => call[0] === 'arc' && call[3] === 3.2);
    const lineCurve = context.calls.find(call => (
      call[0] === 'quadraticCurveTo' &&
      call.at(-2) === eyelet[1] &&
      call.at(-1) === eyelet[2]
    ));
    assert.ok(lineCurve);
  });

  it('keeps bite geometry static across frames when reduced motion is requested', () => {
    let now = 1_000;
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => now });
    renderer.setState({
      selectedRod: { key: 'fishing:rod:weathered' },
      phase: 'bite',
      attempt: { castPower: 60 }
    });
    const first = createContext();
    const second = createContext();

    renderer.render(first, 800, 600);
    now = 1_950;
    renderer.render(second, 800, 600);

    assert.deepEqual(second.calls, first.calls);
  });

  it('uses a static success highlight across reduced-motion frames', () => {
    let now = 1_000;
    const renderer = new FishingRenderer({ reducedMotion: true, now: () => now });
    renderer.setState({ biome: 'Heartlands', phase: 'caught' });
    renderer.triggerSuccess(true);
    const first = createContext();
    const second = createContext();

    now = 1_050;
    renderer.render(first, 800, 600);
    now = 1_150;
    renderer.render(second, 800, 600);

    assert.deepEqual(second.calls, first.calls);
    assert.ok(first.calls.some(call => (
      call[0] === 'ellipse' &&
      call[1] === 800 * 0.60 &&
      call[2] === 600 * 0.62 &&
      call[3] === 44 &&
      call[4] === 15
    )));
  });

  it('cleans all cached rod image handlers when destroyed', () => {
    const imageMock = installImageMock();
    const renderer = new FishingRenderer();

    try {
      renderer.setState({
        selectedRod: { key: 'fishing:rod:weathered' },
        phase: 'idle'
      });
      renderer.setState({
        selectedRod: { key: 'fishing:rod:riverwood' },
        phase: 'idle'
      });
      assert.equal(typeof imageMock.images[0].onload, 'function');
      assert.equal(typeof imageMock.images[1].onerror, 'function');

      renderer.destroy();

      assert.equal(imageMock.images[0].onload, null);
      assert.equal(imageMock.images[0].onerror, null);
      assert.equal(imageMock.images[1].onload, null);
      assert.equal(imageMock.images[1].onerror, null);
      assert.equal(renderer.rodImages.size, 0);
    } finally {
      imageMock.restore();
    }
  });
});

describe('Fishing input accessibility', () => {
  function eventTarget() {
    const listeners = {};
    return {
      disabled: false,
      dataset: {},
      value: '',
      listeners,
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      setPointerCapture() {}
    };
  }

  it('treats a touch pointer hold/release as one cast interaction', () => {
    const cast = eventTarget();
    const hook = eventTarget();
    const cues = eventTarget();
    const rod = eventTarget();
    const tackle = eventTarget();
    const pack = eventTarget();
    const back = eventTarget();
    const elements = {
      '#fishing-cast-button': cast,
      '#fishing-hook-button': hook,
      '#fishing-cues': cues,
      '#fishing-rod-select': rod,
      '#fishing-tackle-select': tackle,
      '#fishing-pack-button': pack,
      '#fishing-back-button': back
    };
    const actions = [];
    const ui = new FishingUI({
      overlay: null,
      nodeName: 'Pond',
      handlers: {
        onCastStart: () => actions.push('start'),
        onCastRelease: () => actions.push('release')
      }
    });
    ui.root = {
      querySelector: selector => elements[selector],
      querySelectorAll: () => [],
      remove() {}
    };
    ui.bind();
    const pointerEvent = {
      pointerId: 9,
      pointerType: 'touch',
      preventDefault() {}
    };

    cast.listeners.pointerdown(pointerEvent);
    cast.listeners.pointerup(pointerEvent);
    cast.listeners.lostpointercapture(pointerEvent);
    cast.dataset.mode = 'release';
    cast.listeners.pointerdown(pointerEvent);

    assert.deepEqual(actions, ['start', 'release', 'release']);
    ui.destroy();
  });

  it('maps Space hold/release and arrow keys to cast and reel controls', () => {
    const listeners = {};
    const originalWindow = globalThis.window;
    globalThis.window = {
      addEventListener(type, listener) {
        listeners[type] = listener;
      }
    };
    const actions = [];
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      castKeyHeld: false,
      controller: {
        state: {
          phase: () => 'idle',
          currentCue: () => ({ index: 2 })
        }
      },
      currentPhaseAllowsCast: () => true,
      beginCast: () => actions.push('start'),
      releaseCast: () => actions.push('release'),
      reel: (direction, cueIndex) => actions.push(`${direction}:${cueIndex}`)
    });
    scene.setupKeyboard();
    const event = {
      code: 'Space',
      key: ' ',
      repeat: false,
      target: { tagName: 'BODY' },
      preventDefault() {}
    };

    listeners.keydown(event);
    listeners.keyup(event);
    scene.controller.state.phase = () => 'reel';
    listeners.keydown({ ...event, code: 'ArrowLeft', key: 'ArrowLeft' });
    scene.controller.state.phase = () => 'cast';
    scene.castKeyHeld = false;
    listeners.keydown(event);

    assert.deepEqual(actions, ['start', 'release', 'left:2', 'release']);
    scene.keyboardAbortController.abort();
    globalThis.window = originalWindow;
  });
});

describe('FishingScene lifecycle cleanup', () => {
  it('shows one visible warning when an all-cues-correct Big Catch escapes', () => {
    const state = new FishingState(() => 1_700_000_000_000);
    const response = bigCatchEscapeResponse();
    const snapshot = state.apply(response);
    const warnings = [];
    const announcements = [];
    const originalWarning = parchmentToast.warning;
    parchmentToast.warning = (...args) => warnings.push(args);
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      sessionLifecycle: 6,
      controller: {},
      renderer: { setState() {} },
      ui: {
        render() {},
        announce: message => announcements.push(message)
      },
      game: { audio: {} },
      lastCatchIdentity: null,
      lastTerminalOutcomeIdentity: null,
      lastPhase: 'reel'
    });

    try {
      scene.onStateChange(snapshot, response, 6);
      scene.onStateChange(snapshot, response, 6);

      assert.deepEqual(warnings, [[
        'Big Catch Escaped',
        snapshot.resultMessage
      ]]);
      assert.deepEqual(announcements, [snapshot.resultMessage]);
      assert.match(warnings[0][1], /No fish was added/i);
    } finally {
      parchmentToast.warning = originalWarning;
    }
  });

  it('idempotently resumes an authoritative resolve phase after refresh', () => {
    let resolves = 0;
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      sessionLifecycle: 4,
      lastPhase: 'reel',
      deadlineSyncKey: null,
      resolveSync: null,
      controller: {
        state: {
          snapshot: () => ({
            phase: 'resolve',
            attempt: {
              attemptId: 'attempt-resolve',
              phase: 'resolve',
              revision: 8
            }
          })
        },
        resolve: () => {
          resolves += 1;
          return Promise.resolve();
        }
      },
      renderer: { setState() {} },
      ui: { render() {} },
      handleActionError() {}
    });

    scene.refreshTimeState(4);
    scene.refreshTimeState(4);

    assert.equal(resolves, 1);
  });

  it('deduplicates a final-cue resolve after a deterministic rejection', async () => {
    const error = new Error('deterministic conflict');
    const snapshot = {
      phase: 'resolve',
      attempt: {
        attemptId: 'attempt-final-cue',
        phase: 'resolve',
        revision: 8
      }
    };
    let resolves = 0;
    let refreshes = 0;
    let notifications = 0;
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      sessionLifecycle: 7,
      lastPhase: 'reel',
      lastCatchIdentity: null,
      lastTerminalOutcomeIdentity: null,
      deadlineSyncKey: null,
      resolveSync: null,
      controller: null,
      renderer: { setState() {} },
      ui: { render() {} },
      game: { audio: {} },
      handleActionError: () => {
        notifications += 1;
      }
    });
    scene.controller = {
      state: { snapshot: () => snapshot },
      resolve() {
        resolves += 1;
        // FishingController invokes its configured onError before rejecting.
        scene.handleActionError(error, 7);
        return Promise.reject(error);
      },
      refresh() {
        refreshes += 1;
        return Promise.resolve(snapshot);
      }
    };

    scene.onStateChange(snapshot, { message: 'Reeling complete.' }, 7);
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let tick = 0; tick < 5; tick += 1) {
      scene.refreshTimeState(7);
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(resolves, 1);
    assert.equal(refreshes, 1);
    assert.equal(notifications, 1);
    assert.equal(scene.resolveSync.key, 'attempt-final-cue:8:resolve');
  });

  it('reconciles and retries an ambiguous resolve only once', async () => {
    const error = Object.assign(
      new Error('network interrupted'),
      { isNetworkError: true }
    );
    let snapshot = {
      phase: 'resolve',
      attempt: {
        attemptId: 'attempt-network',
        phase: 'resolve',
        revision: 8
      }
    };
    let resolves = 0;
    let refreshes = 0;
    let notifications = 0;
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      sessionLifecycle: 8,
      lastPhase: 'reel',
      lastCatchIdentity: null,
      lastTerminalOutcomeIdentity: null,
      deadlineSyncKey: null,
      resolveSync: null,
      controller: null,
      renderer: { setState() {} },
      ui: { render() {} },
      game: { audio: {} },
      handleActionError: () => {
        notifications += 1;
      }
    });
    scene.controller = {
      state: { snapshot: () => snapshot },
      resolve() {
        resolves += 1;
        if (resolves === 1) {
          scene.handleActionError(error, 8);
          return Promise.reject(error);
        }
        snapshot = {
          phase: 'resolved',
          attempt: {
            attemptId: 'attempt-network',
            phase: 'resolved',
            revision: 9,
            outcome: { result: 'caught', awarded: true }
          }
        };
        return Promise.resolve(snapshot);
      },
      refresh() {
        refreshes += 1;
        return Promise.resolve(snapshot);
      }
    };

    scene.onStateChange(snapshot, { message: 'Reeling complete.' }, 8);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let tick = 0; tick < 5; tick += 1) {
      scene.refreshTimeState(8);
    }

    assert.equal(resolves, 2);
    assert.equal(refreshes, 1);
    assert.equal(notifications, 1);
    assert.equal(scene.resolveSync.ambiguousRetries, 1);
  });

  it('reports one warning when the bounded ambiguous retry also fails', async () => {
    const error = Object.assign(
      new Error('network interrupted'),
      { isTimeout: true }
    );
    const snapshot = {
      phase: 'resolve',
      attempt: {
        attemptId: 'attempt-outage',
        phase: 'resolve',
        revision: 8
      }
    };
    const warnings = [];
    let resolves = 0;
    let refreshes = 0;
    const originalWarning = parchmentToast.warning;
    parchmentToast.warning = (...args) => warnings.push(args);
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      sessionLifecycle: 9,
      lastPhase: 'reel',
      lastCatchIdentity: null,
      lastTerminalOutcomeIdentity: null,
      lastReportedResolveErrorKey: null,
      deadlineSyncKey: null,
      resolveSync: null,
      controller: null,
      renderer: { setState() {} },
      ui: { render() {} },
      game: { audio: {} }
    });
    scene.controller = {
      state: { snapshot: () => snapshot },
      resolve() {
        resolves += 1;
        scene.handleActionError(error, 9, {
          key: 'resolve:attempt-outage',
          actionId: 'stable-action-id'
        });
        return Promise.reject(error);
      },
      refresh() {
        refreshes += 1;
        return Promise.resolve(snapshot);
      }
    };

    try {
      scene.onStateChange(snapshot, { message: 'Reeling complete.' }, 9);
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
      for (let tick = 0; tick < 5; tick += 1) {
        scene.refreshTimeState(9);
      }

      assert.equal(resolves, 2);
      assert.equal(refreshes, 1);
      assert.deepEqual(warnings, [[
        'Connection Interrupted',
        'The result is uncertain. Fishing will safely reconcile it; reopen this spot if the prompt remains.'
      ]]);
    } finally {
      parchmentToast.warning = originalWarning;
    }
  });

  it('destroys controller, renderer, UI, listeners, and animation timer on exit', () => {
    const calls = [];
    const timer = setInterval(() => {}, 1000);
    const scene = Object.assign(Object.create(FishingScene.prototype), {
      game: { audio: { stopAmbient: () => calls.push('ambient') } },
      sessionLifecycle: 3,
      updateTimer: timer,
      responsiveUnsubscribe: () => calls.push('responsive'),
      keyboardAbortController: { abort: () => calls.push('keyboard') },
      motionQuery: { removeEventListener: () => calls.push('motion') },
      motionListener() {},
      controller: { destroy: () => calls.push('controller') },
      renderer: { destroy: () => calls.push('renderer') },
      ui: { destroy: () => calls.push('ui') },
      endInFlight: null,
      resolveSync: { key: 'attempt:8:resolve' },
      lastReportedResolveErrorKey: 'resolve:attempt',
      lastTerminalOutcomeIdentity: 'attempt:big_catch_escaped'
    });

    scene.exit();

    assert.equal(scene.sessionLifecycle, 4);
    assert.equal(scene.updateTimer, null);
    assert.equal(scene.controller, null);
    assert.equal(scene.renderer, null);
    assert.equal(scene.ui, null);
    assert.equal(scene.resolveSync, null);
    assert.equal(scene.lastReportedResolveErrorKey, null);
    assert.equal(scene.lastTerminalOutcomeIdentity, null);
    assert.deepEqual(calls, [
      'responsive',
      'keyboard',
      'motion',
      'controller',
      'renderer',
      'ui',
      'ambient'
    ]);
  });
});
