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

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return { matches: false };
  }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0 }
});
globalThis.document = {
  createElement() {
    return { id: '', textContent: '' };
  },
  head: { appendChild() {} }
};

const { BattleUI } = await import('../BattleUI.js');
const { default: TurnOrderModal } = await import('../TurnOrderModal.js');

describe('BattleUI turn order synchronization', () => {
  it('caches predictions while the modal is closed so they render when it opens', async () => {
    const predictions = [
      { id: 'hero', name: 'Hero', type: 'player', hp: 80, maxHp: 100, ct: 100 },
      { id: 'goblin', name: 'Goblin', type: 'enemy', hp: 30, maxHp: 30, ct: 75 }
    ];
    const turnOrderModal = Object.create(TurnOrderModal.prototype);
    Object.assign(turnOrderModal, {
      turnQueue: [],
      currentRenderId: 0,
      contentContainer: null,
      isOpen: () => false
    });
    const ui = Object.assign(Object.create(BattleUI.prototype), {
      turnOrderPanel: null,
      menuDropdown: null,
      turnOrderModal
    });

    ui.updateTurnOrder({ turnPredictions: predictions });

    assert.deepEqual(turnOrderModal.turnQueue, predictions);

    turnOrderModal.contentContainer = { innerHTML: '' };
    turnOrderModal.renderUnit = async unit => `<span>${unit.name}</span>`;
    await TurnOrderModal.prototype.render.call(turnOrderModal);

    assert.match(turnOrderModal.contentContainer.innerHTML, /Hero/);
    assert.match(turnOrderModal.contentContainer.innerHTML, /Goblin/);
    assert.doesNotMatch(turnOrderModal.contentContainer.innerHTML, /No turns to display/);
  });
});
