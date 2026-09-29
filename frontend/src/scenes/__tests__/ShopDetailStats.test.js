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
const render = (item) => ShopScene.prototype.renderDetailStats.call({}, item);

describe('ShopScene detail stats', () => {
  it('sums rolled base and bonus stats for the same key', () => {
    const html = render({ baseStats: { strength: 5 }, bonusStats: { strength: 3, agility: 2 } });
    assert.match(html, /Strength<\/span>\s*<span class="detail-stat-value positive">\+8</);
    assert.match(html, /Agility/);
  });

  it('marks negative stats as negative, not positive', () => {
    const html = render({ statBonuses: { agility: -2, vitality: 4 } });
    assert.match(html, /detail-stat-value negative">-2</);
    assert.match(html, /detail-stat-value positive">\+4</);
  });

  it('uses readable stat names instead of raw keys', () => {
    const html = render({ statBonuses: { hp_max: 20 } });
    assert.doesNotMatch(html, />hp_max</);
  });

  it('renders potion effects as effect rows, not as +N stats', () => {
    const html = render({ statBonuses: { hp_restore: 150 }, type: 'consumable' });
    assert.match(html, /effect-row/);
    assert.match(html, /Restores 150 HP/);
    assert.doesNotMatch(html, /\+150/);

    const caravan = render({ effect: { hp_restore: 200, mp_restore: 100 } });
    assert.match(caravan, /Restores 200 HP/);
    assert.match(caravan, /Restores 100 MP/);

    const box = render({ statBonuses: { opens_to: 'random_rare' } });
    assert.match(box, /Contains a random rare item/);
  });

  it('renders augment objects as text rather than [object Object]', () => {
    const html = render({
      baseStats: { strength: 1 },
      augments: [{ name: 'Flaming', category: 'fire', effect: { type: 'fire_damage', value: 10 } }]
    });
    assert.doesNotMatch(html, /\[object Object\]/);
    assert.match(html, /Flaming/);
  });

  it('escapes item-provided text', () => {
    const html = render({ augments: [{ name: '<img src=x>' }] });
    assert.doesNotMatch(html, /<img src=x>/);
  });
});
