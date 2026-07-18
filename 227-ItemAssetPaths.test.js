import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
globalThis.document = {
  createElement() { return { id: '', textContent: '' }; },
  getElementById() { return null; },
  head: { appendChild() {} }
};

const [
  { ItemIcon },
  { normalizeItemSubcategory }
] = await Promise.all([
  import('../../components/ItemIcon.js'),
  import('../assetLoader/ItemCompositing.js')
]);

describe('canonical item asset resolution', () => {
  it('maps every runtime item family to a sized canonical ItemIcon path', () => {
    assert.equal(
      ItemIcon.getSrc({ item: { spriteId: 'sword_long', type: 'weapon' }, size: 'sm' }),
      '/assets/items/32/weapons/sword_long.webp'
    );
    assert.equal(
      ItemIcon.getSrc({ item: { sprite_id: 'armor_chain', item_type: 'armor' }, size: 'lg' }),
      '/assets/items/64/armor/armor_chain.webp'
    );
    assert.equal(
      ItemIcon.getSrc({ item: { spriteId: 'ring_gem', itemType: 'accessory' }, size: 'md' }),
      '/assets/items/32/accessories/ring_gem.webp'
    );
    assert.equal(
      ItemIcon.getSrc({ item: { spriteId: 'material_dragon_scale', type: 'material' }, size: 'xl' }),
      '/assets/items/64/consumables/material_dragon_scale.webp'
    );
    assert.equal(ItemIcon.getSrc({ item: { name: 'Legacy snapshot' } }), null);
  });

  it('normalizes legacy compositing categories to the canonical four folders', () => {
    assert.equal(normalizeItemSubcategory('materials'), 'consumables');
    assert.equal(normalizeItemSubcategory('gauntlets'), 'accessories');
    assert.equal(normalizeItemSubcategory('robe'), 'armor');
    assert.equal(normalizeItemSubcategory('wand'), 'weapons');
  });
});
