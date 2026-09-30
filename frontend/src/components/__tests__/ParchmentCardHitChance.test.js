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
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  addEventListener: noop,
  removeEventListener: noop
};
globalThis.document ??= {
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
  getElementById: () => null,
  head: { appendChild: noop },
  documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } },
  body: { classList: { add: noop, remove: noop, toggle: noop } }
};

globalThis.requestAnimationFrame ??= noop;
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
}

const { ParchmentCard } = await import('../ParchmentCard.js');

function renderPreview(data) {
  const card = Object.create(ParchmentCard.prototype);
  card.element = { style: {}, appendChild: noop };
  card.damagePreviewElement = { innerHTML: '', style: {}, classList: { add: noop, remove: noop } };
  card.showDamagePreview(data);
  return card.damagePreviewElement.innerHTML;
}

const attack = { type: 'physical', minDamage: 10, maxDamage: 14, hitChance: 0.55, critChance: 0.1, critDamage: 21 };

describe('ParchmentCard damage preview hit chance', () => {
  it('shows the real hit chance by default', () => {
    assert.match(renderPreview(attack), /55% hit/);
  });

  it('omits the hit chance when showHitChance is false instead of claiming 100%', () => {
    const html = renderPreview({ ...attack, showHitChance: false });
    assert.doesNotMatch(html, /% hit/);
    assert.match(html, /10-14/);
    assert.match(html, /10% crit/);
  });

  it('omits the hit chance when none is supplied', () => {
    const { hitChance: _omit, ...noHit } = attack;
    assert.doesNotMatch(renderPreview(noHit), /hit/);
  });
});
