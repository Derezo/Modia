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
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
}
// escapeHtml relies on textContent -> innerHTML serialization; emulate it.
function fakeElement() {
  let text = '';
  return {
    style: { setProperty: noop },
    classList: { add: noop, remove: noop, toggle: noop },
    appendChild: noop,
    setAttribute: noop,
    set textContent(value) { text = String(value); },
    get textContent() { return text; },
    get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  };
}
globalThis.document ??= {
  createElement: fakeElement,
  getElementById: () => null,
  head: { appendChild: noop },
  documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } },
  body: { classList: { add: noop, remove: noop, toggle: noop } }
};

const { ShopScene } = await import('../ShopScene.js');
const { ItemIcon } = await import('../../components/ItemIcon.js');
const { parchmentToast } = await import('../../ui/parchment/ParchmentToast.js');

// Toasts need a real DOM; record them instead
const toasts = [];
parchmentToast.success = (title) => { toasts.push(['success', title]); };
parchmentToast.error = (title, message) => { toasts.push(['error', title, message]); };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeUi() {
  const nodes = {
    '#player-gold': { textContent: '' },
    '#detail-content': { innerHTML: '', querySelector: () => null }
  };
  return { nodes, querySelector: (sel) => nodes[sel] || null, remove: noop };
}

function makeScene({ api = {} } = {}) {
  const state = new Map([['user', { gold: 100 }], ['characters', []]]);
  const scene = Object.create(ShopScene.prototype);
  Object.assign(scene, {
    game: {
      api,
      state: { get: (k) => state.get(k), set: (k, v) => state.set(k, v) },
      audio: null
    },
    uiElement: fakeUi(),
    nodeId: 1,
    shopType: 'general',
    activeTab: 'buy',
    selectedItem: null,
    purchaseQuantity: 1,
    isBuying: false,
    isSelling: false,
    sellConfirm: null,
    detailRenderSeq: 0,
    shopInventory: [],
    sellableItems: [],
    playerGold: 100,
    itemTable: null
  });
  // Rendering the table and detail panel needs a real DOM; not under test here
  scene.loadShopData = async () => {};
  scene.renderDetailPanel = async () => {};
  return { scene, state };
}

describe('ShopScene purchase guard', () => {
  it('sends one buy request when Purchase is clicked twice', async () => {
    const pending = deferred();
    let calls = 0;
    const { scene } = makeScene({
      api: { buyFromShop: () => { calls++; return pending.promise; } }
    });
    scene.selectedItem = { templateId: 7, buyPrice: 10 };

    const first = scene.handleBuy();
    const second = scene.handleBuy();
    pending.resolve({ remainingGold: 90, message: 'ok' });
    await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.equal(scene.isBuying, false);
    assert.equal(toasts.filter(t => t[0] === 'error').length, 0, JSON.stringify(toasts));
  });

  it('records the committed gold when the scene exits mid-purchase', async () => {
    const pending = deferred();
    const { scene, state } = makeScene({
      api: { buyFromShop: () => pending.promise }
    });
    scene.selectedItem = { templateId: 7, buyPrice: 10 };

    const buying = scene.handleBuy();
    scene.uiElement = null; // exit()
    pending.resolve({ remainingGold: 90, message: 'ok' });
    await buying;

    assert.equal(state.get('user').gold, 90);
    assert.equal(scene.isBuying, false);
  });
});

describe('ShopScene sell after exit', () => {
  it('keeps client gold in sync and does not throw when the scene is gone', async () => {
    const pending = deferred();
    const { scene, state } = makeScene({
      api: { sellToShop: () => pending.promise }
    });
    scene.activeTab = 'sell';
    scene.selectedItem = { instanceId: 3, sellPrice: 5, rarity: 'common' };

    const selling = scene.handleSell();
    scene.uiElement = null;
    pending.resolve({ newGold: 105, message: 'sold' });
    await selling;

    assert.equal(state.get('user').gold, 105);
    assert.ok(!toasts.some(t => t[1] === 'Sale Failed'), 'a committed sale is not reported as failed');
  });
});

describe('ShopScene detail panel', () => {
  it('drops an older render that finishes after a newer selection', async () => {
    const icons = [];
    const original = ItemIcon.compositeHtml;
    ItemIcon.compositeHtml = () => {
      const d = deferred();
      icons.push(d);
      return d.promise;
    };
    try {
      const { scene } = makeScene();
      delete scene.renderDetailPanel; // use the real prototype method
      scene.renderDetailStats = () => '';
      const itemA = { templateId: 1, name: 'Item A', buyPrice: 1, rarity: 'common' };
      const itemB = { templateId: 2, name: 'Item B', buyPrice: 1, rarity: 'common' };

      scene.selectedItem = itemA;
      const renderA = scene.renderDetailPanel();
      scene.selectedItem = itemB;
      const renderB = scene.renderDetailPanel();

      icons[1].resolve('<img>');
      await renderB;
      icons[0].resolve('<img>');
      await renderA;

      const html = scene.uiElement.nodes['#detail-content'].innerHTML;
      assert.match(html, /Item B/);
      assert.doesNotMatch(html, /Item A/);
    } finally {
      ItemIcon.compositeHtml = original;
    }
  });
});
