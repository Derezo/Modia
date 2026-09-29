/**
 * Regression tests for the release/0.5.2 frontend follow-ups:
 * preview request cancellation, marketplace tab counts, trait tooltips,
 * toast placement, augment "included above" rendering, clan leadership
 * transfer and the coliseum rating header.
 */
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
  },
  // Scenes import their stylesheet for Vite; under node:test it is an empty module
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return nextLoad(url, context);
  }
});

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

function fakeElement(tagName = 'div') {
  let text = '';
  const classes = new Set();
  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    style: { setProperty() {} },
    dataset: {},
    children: [],
    set textContent(value) { text = String(value); },
    get textContent() { return text; },
    set innerHTML(value) { text = String(value); },
    get innerHTML() {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c),
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      }
    },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    remove() {}
  };
}

globalThis.document = {
  createElement: fakeElement,
  head: { appendChild() {} },
  body: { appendChild() {} },
  getElementById() { return null; },
  querySelector() { return null; }
};

const { ApiClient } = await import('../../api/client.js');
const { RegistrationWizard } = await import('../auth/RegistrationWizard.js');
const { MarketplaceScene } = await import('../MarketplaceScene.js');
const { ColiseumScene } = await import('../ColiseumScene.js');
const { ParchmentCard } = await import('../../components/ParchmentCard.js');
const { ItemDetailModal } = await import('../../components/modals/ItemDetailModal.js');
const { parchmentToast } = await import('../../ui/parchment/ParchmentToast.js');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function previewResponse(hpMax) {
  return {
    stats: { hpMax, mpMax: 10, strength: 1, intelligence: 1, agility: 1, vitality: 1, luck: 1 },
    traits: {}
  };
}

describe('ApiClient follow-up endpoints', () => {
  it('getCharacterPreview forwards the abort signal to the request', async () => {
    const client = new ApiClient('/api');
    const calls = [];
    client.get = (endpoint, options) => { calls.push({ endpoint, options }); return Promise.resolve({}); };
    const controller = new AbortController();

    await client.getCharacterPreview('elf', 'wizard', { signal: controller.signal });

    assert.equal(calls[0].endpoint, '/characters/preview?race=elf&characterClass=wizard');
    assert.equal(calls[0].options.signal, controller.signal);
  });

  it('transferClanLeadership posts the new leader to the clan transfer route', async () => {
    const client = new ApiClient('/api');
    const calls = [];
    client.post = (endpoint, data) => { calls.push({ endpoint, data }); return Promise.resolve({ success: true }); };

    await client.transferClanLeadership(7, 42);

    assert.deepEqual(calls, [{ endpoint: '/clans/7/transfer', data: { userId: 42 } }]);
  });
});

describe('RegistrationWizard.fetchPreview', () => {
  it('aborts the superseded request and ignores its late response', async () => {
    const pending = [];
    const shown = [];
    const wizard = {
      previewFetchAbort: null,
      formData: { race: 'elf', characterClass: 'wizard', gender: 'female' },
      previewCard: {
        setCharacter: c => shown.push(c.maxHp),
        setTraits() {}
      },
      getPreviewName: () => 'Hero',
      game: {
        api: {
          getCharacterPreview(race, cls, options) {
            const d = deferred();
            pending.push({ ...d, signal: options?.signal });
            return d.promise;
          }
        }
      }
    };
    const fetchPreview = RegistrationWizard.prototype.fetchPreview;

    const first = fetchPreview.call(wizard);
    const second = fetchPreview.call(wizard);

    assert.ok(pending[0].signal, 'first request received a signal');
    assert.equal(pending[0].signal.aborted, true, 'first request is aborted by the second');
    assert.equal(pending[1].signal.aborted, false);

    // The newer request answers first, then the stale one resolves anyway.
    pending[1].resolve(previewResponse(200));
    await second;
    pending[0].resolve(previewResponse(100));
    await first;

    assert.deepEqual(shown, [200], 'only the newest preview reaches the card');
  });
});

describe('MarketplaceScene.loadInitialData', () => {
  it('refreshes the tab counts once orders and listings arrive', async () => {
    let tabUpdates = 0;
    const scene = {
      game: {
        api: {
          searchMarketItems: async () => ({ items: [] }),
          getMyOrders: async () => ({ orders: [{ id: 1 }, { id: 2 }] }),
          getMyListings: async () => ({ listings: [{ id: 3 }] }),
          getSellableInventory: async () => ({ items: [] })
        }
      },
      updateTabs() { tabUpdates++; },
      renderContent() {}
    };

    await MarketplaceScene.prototype.loadInitialData.call(scene);

    assert.equal(scene.myOrders.length, 2);
    assert.equal(scene.myListings.length, 1);
    assert.equal(tabUpdates, 1);
  });

  it('updateTabs is a no-op once the scene UI is gone', () => {
    assert.doesNotThrow(() => MarketplaceScene.prototype.updateTabs.call({ uiElement: null }));
  });
});

describe('ParchmentCard trait tooltips', () => {
  it('re-binds tooltip listeners on every render, including setTraits()', () => {
    let binds = 0;
    const card = Object.create(ParchmentCard.prototype);
    Object.assign(card, {
      element: fakeElement(),
      options: {},
      traits: [],
      lastKnownValues: {},
      attachTooltipListeners() { binds++; }
    });
    card.character = {
      name: 'Hero', level: 1, race: 'elf', class: 'wizard', gender: 'female',
      hp: 10, maxHp: 10, mp: 5, maxMp: 5,
      strength: 1, intelligence: 1, agility: 1, vitality: 1, luck: 1
    };

    card.setTraits([{ name: 'Keen', description: 'Sharp eyes', type: 'racial' }]);
    assert.equal(binds, 1, 'setTraits binds tooltips');

    card.update({ hp: 5 });
    assert.equal(binds, 2, 'update binds tooltips');
  });
});

describe('parchmentToast placement', () => {
  it('anchors bottom-centre on request and back to the top', () => {
    const container = parchmentToast.ensureContainer();
    parchmentToast.setPlacement('bottom');
    assert.equal(container.classList.contains('parchment-toast-container--bottom'), true);
    parchmentToast.setPlacement('top');
    assert.equal(container.classList.contains('parchment-toast-container--bottom'), false);
    parchmentToast.setPlacement('nonsense');
    assert.equal(parchmentToast.placement, 'top');
  });
});

describe('ItemDetailModal augments', () => {
  const render = aug => ItemDetailModal.prototype.renderAugment.call({}, aug);

  it('names a stat_bonus augment without repeating its bonus', () => {
    const html = render({ name: 'Mighty', effect: { type: 'stat_bonus', stat: 'strength', value: 5 } });
    assert.match(html, /Mighty/);
    assert.match(html, /\(included above\)/);
    assert.doesNotMatch(html, /item-detail-augment-effect/, 'the +5 Strength effect text is not listed again');
  });

  it('keeps a non-stat effect and notes its stat roll is already counted', () => {
    const html = render({ name: 'Keen Edge', effect: { type: 'crit_chance', value: 0.05 }, stat: 'agility', value: 3 });
    assert.match(html, /item-detail-augment-effect/);
    assert.match(html, /\(stat bonus included above\)/);
    assert.doesNotMatch(html, /in stats\)/);
  });
});

describe('ColiseumScene header rating', () => {
  const render = playerStats => ColiseumScene.prototype.renderPlayerRating.call({ playerStats });

  it('shows the 1v1 tier and rating from /coliseum/stats', () => {
    const html = render([
      { queueType: '3v3', rating: 1500, tier: 'Gold', tierColor: '#b8956a' },
      { queueType: '1v1', rating: 1215.4, tier: 'Silver', tierColor: '#c0c0c0' }
    ]);
    assert.match(html, /Silver/);
    assert.match(html, />1215</);
    assert.match(html, /1v1 rating/);
    assert.match(html, /--tier-color: #c0c0c0/);
  });

  it('reads Unranked with no rated matches and renders nothing before load', () => {
    assert.match(render([]), /Unranked/);
    assert.equal(render(null), '');
  });

  it('drops a tier colour that is not a hex value', () => {
    const html = render([{ queueType: '1v1', rating: 1000, tier: 'Bronze', tierColor: 'red;background:url(x)' }]);
    assert.doesNotMatch(html, /--tier-color/);
  });
});

describe('ItemDetailModal use-item targets', () => {
  const filterFor = item => ItemDetailModal.prototype.getValidTargetsFilter.call({ item });
  // Raw GET /api/characters rows, as ItemsModal passes them
  const hurt = { id: 1, hp_current: 40, hp_max: 128, mp_current: 50, mp_max: 50 };
  const full = { id: 2, hp_current: 128, hp_max: 128, mp_current: 10, mp_max: 50 };
  const fallen = { id: 3, hp_current: 0, hp_max: 128, mp_current: 0, mp_max: 50 };

  it('offers a healing potion to a wounded character given raw hp_current/hp_max rows', () => {
    const valid = [hurt, full, fallen].filter(filterFor({ name: 'Health Potion', effectType: 'heal_hp' }));
    assert.deepEqual(valid.map(c => c.id), [1]);
  });

  it('treats a Mana Potion as MP restoration, not healing', () => {
    const valid = [hurt, full, fallen].filter(filterFor({ name: 'Mana Potion', effectType: 'heal_mp' }));
    assert.deepEqual(valid.map(c => c.id), [2]);
  });

  it('offers a revive item only to a fallen character', () => {
    const valid = [hurt, full, fallen].filter(filterFor({ name: 'Phoenix Feather', effectType: 'revive' }));
    assert.deepEqual(valid.map(c => c.id), [3]);
  });

  it('reads the effects of the use-item response', () => {
    const msg = ItemDetailModal.prototype.getEffectMessage.call({ item: { name: 'X' } }, { effects: { hp_restored: 50 } });
    assert.equal(msg, 'Restored 50 HP');
  });
});
