import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACTIVE_AUGMENT_EFFECT_TYPES, describeAugment } from '../statDisplay.js';

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), '../../components');

describe('augment "not yet active" styling', () => {
  it('follows ACTIVE_AUGMENT_EFFECT_TYPES, so wiring a type in battle clears the styling', () => {
    const augment = { name: 'Vampiric', category: 'dark', effect: { type: 'lifesteal', value: 5 } };
    const wasActive = ACTIVE_AUGMENT_EFFECT_TYPES.has('lifesteal');
    try {
      ACTIVE_AUGMENT_EFFECT_TYPES.add('lifesteal');
      assert.equal(describeAugment(augment).active, true);
      ACTIVE_AUGMENT_EFFECT_TYPES.delete('lifesteal');
      assert.equal(describeAugment(augment).active, false);
    } finally {
      if (wasActive) ACTIVE_AUGMENT_EFFECT_TYPES.add('lifesteal');
    }
  });

  it('components derive inactive state from describeAugment, not a local type list', () => {
    // AugmentList.js is the shared augment line used by the item detail and
    // equip modals, the shop and every marketplace panel. It takes its
    // wording and inactive state from describeAugmentLine (statDisplay.js),
    // which derives them from describeAugment.
    const augmentList = readFileSync(join(componentsDir, 'AugmentList.js'), 'utf8');
    assert.match(augmentList, /describeAugmentLine\(aug\)/, 'AugmentList.js');
    assert.doesNotMatch(augmentList, /fire_damage|lifesteal|crit_chance/, 'AugmentList.js hardcodes augment effect types');
    const statDisplay = readFileSync(join(componentsDir, '../utils/statDisplay.js'), 'utf8');
    const lineFn = statDisplay.slice(statDisplay.indexOf('export function describeAugmentLine'));
    assert.match(lineFn, /describeAugment\(aug\)/, 'describeAugmentLine derives from describeAugment');

    const renderers = [
      ['components', 'modals/ItemDetailModal.js', /from '\.\.\/AugmentList\.js'/],
      ['components', 'modals/EquipmentSlotModal.js', /from '\.\.\/AugmentList\.js'/],
      ['components', 'MarketplaceItemPanel.js', /from '\.\/AugmentList\.js'/],
      ['scenes', 'marketplace/tabs/MarketplaceSearchTab.js', /from '\.\.\/\.\.\/\.\.\/components\/AugmentList\.js'/]
    ];
    for (const [root, file, importPattern] of renderers) {
      const source = readFileSync(join(componentsDir, '..', root, file), 'utf8');
      assert.match(source, importPattern, `${file} renders augments through AugmentList`);
      assert.doesNotMatch(source, /fire_damage|lifesteal|crit_chance/, `${file} hardcodes augment effect types`);
      assert.doesNotMatch(source, /describeAugment\(/, `${file} builds its own augment markup`);
    }
  });
});
