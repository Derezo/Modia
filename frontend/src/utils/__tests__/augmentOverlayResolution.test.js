import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { resolveAugmentOverlayId, resolveAugmentOverlayIds } from '../statDisplay.js';
import { OverlayCompositor } from '../OverlayCompositor.js';
import { loadItemComposite } from '../../core/assetLoader/ItemCompositing.js';
import { AUGMENTS, CONSUMABLE_AUGMENTS } from '../../../../api/src/services/itemDropService.js';

const overlayDir = join(dirname(fileURLToPath(import.meta.url)), '../../../public/assets/overlays/128/augments');

function allDropAugments() {
  // Both tables are keyed by augment id with a definition object as the value
  return [...Object.values(AUGMENTS), ...Object.values(CONSUMABLE_AUGMENTS)]
    .filter(a => a && typeof a === 'object');
}

describe('resolveAugmentOverlayId', () => {
  it('resolves categories, including those only reachable through the icon resolver', () => {
    assert.equal(resolveAugmentOverlayId('fire'), 'augment_fire');
    assert.equal(resolveAugmentOverlayId('dragon_slayer'), 'augment_slayer');
    // stun_chance has no shared overlay alias; icon resolver maps it to 'stagger'
    assert.equal(resolveAugmentOverlayId('stun_chance'), 'augment_stun');
    assert.equal(resolveAugmentOverlayId('fire_damage'), 'augment_fire');
  });

  it('uses the effect type or stat of an augment object when the category is unknown', () => {
    assert.equal(resolveAugmentOverlayId({ category: 'mystery', effect: { type: 'lifesteal' } }), 'augment_lifesteal');
    assert.equal(resolveAugmentOverlayId({ effect: { type: 'stat_bonus', stat: 'agility' } }), 'augment_speed');
  });

  it('returns null for unknown or path-like augments instead of a misleading glow', () => {
    assert.equal(resolveAugmentOverlayId('totally_unknown'), null);
    assert.equal(resolveAugmentOverlayId('../../etc/passwd'), null);
    assert.equal(resolveAugmentOverlayId(null), null);
  });

  it('dedupes and preserves order', () => {
    assert.deepEqual(resolveAugmentOverlayIds(['fire', 'fire_damage', 'ice']), ['augment_fire', 'augment_ice']);
  });

  it('gives every drop-table augment an overlay whose file exists', () => {
    const augments = allDropAugments();
    assert.ok(augments.length > 0, 'expected drop-table augments');
    for (const augment of augments) {
      const overlayId = resolveAugmentOverlayId(augment);
      assert.ok(overlayId, `no overlay for ${JSON.stringify(augment).slice(0, 120)}`);
      assert.ok(existsSync(join(overlayDir, `${overlayId}.webp`)), `missing file for ${overlayId}`);
    }
  });
});

describe('compositors resolve augment objects', () => {
  it('OverlayCompositor keys the composite on resolved overlay ids', async () => {
    const compositor = new OverlayCompositor();
    const requested = [];
    compositor.loadImage = async (src) => { requested.push(src); return {}; };
    compositor.composeSprite = () => 'data:composite';

    await compositor.composite({
      spriteId: 'sword_short',
      subcategory: 'weapons',
      size: 64,
      rarity: 'rare',
      augments: [{ category: 'stun_chance' }, 'hot_minor']
    });

    assert.ok(requested.some(src => src.includes('augment_stun')));
    assert.ok(requested.some(src => src.includes('augment_vitality')));
  });

  it('loadItemComposite resolves an augment object to its overlay', async () => {
    const requested = [];
    const context = {
      cache: new Map(),
      loadImage: async (src) => { requested.push(src); return { width: 128, height: 128 }; }
    };
    await loadItemComposite(context, '/assets', 'sword_short', 'weapon', 'common', { effect: { type: 'fire_damage' } })
      .catch(() => null);
    assert.ok(requested.some(src => src.includes('augment_fire')), requested.join(','));
  });
});
