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
    for (const file of ['MarketplaceItemPanel.js', 'modals/ItemDetailModal.js', 'modals/EquipmentSlotModal.js']) {
      const source = readFileSync(join(componentsDir, file), 'utf8');
      assert.match(source, /describeAugment\(aug\)/, file);
      assert.doesNotMatch(source, /fire_damage|lifesteal|crit_chance/, `${file} hardcodes augment effect types`);
    }
  });
});
