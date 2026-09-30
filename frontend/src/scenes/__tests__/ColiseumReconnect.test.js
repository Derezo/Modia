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

const { ColiseumScene } = await vite.ssrLoadModule('/src/scenes/ColiseumScene.js');
const { parchmentToast } = await vite.ssrLoadModule('/src/ui/parchment/ParchmentToast.js');

const toasts = [];
parchmentToast.warning = (title) => { toasts.push(title); };
parchmentToast.success = noop;
parchmentToast.info = noop;
parchmentToast.error = noop;

function coliseumWithHandlers() {
  const handlers = {};
  const scene = Object.create(ColiseumScene.prototype);
  Object.assign(scene, {
    game: { socket: { on: (type, fn) => { handlers[type] = fn; }, send: noop } },
    wsHandlers: {},
    currentMatch: null,
    isInQueue: true,
    selectedQueue: 'solo',
    matchCountdown: null
  });
  scene.updateTabs = noop;
  scene.updateContent = noop;
  scene.loadQueueStatuses = async () => {};
  scene.setupWebSocketHandlers();
  return { scene, handlers };
}

describe('ColiseumScene reconnect during the ready check', () => {
  it('clears a match that was still in the ready check', () => {
    const { scene, handlers } = coliseumWithHandlers();
    handlers['coliseum:match_found']({ matchId: 7, opponent: { name: 'Rival' }, readyDeadline: Date.now() + 30000 });
    assert.equal(scene.currentMatch.status, 'pending');

    toasts.length = 0;
    handlers.connect();
    assert.equal(scene.currentMatch, null);
    assert.ok(toasts.includes('Match Cancelled'));
  });

  it('keeps a match that has moved on to formation selection', () => {
    const { scene, handlers } = coliseumWithHandlers();
    handlers['coliseum:match_found']({ matchId: 8, opponent: { name: 'Rival' }, readyDeadline: Date.now() + 30000 });
    scene.currentMatch.status = 'formation_selection';
    handlers.connect();
    assert.equal(scene.currentMatch.matchId, 8);
  });
});
