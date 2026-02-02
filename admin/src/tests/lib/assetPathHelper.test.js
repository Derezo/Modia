import { describe, it, expect, vi } from 'vitest';

// Mock the shared module
vi.mock('@shared/assetPaths.js', () => ({
  getAssetPath: vi.fn((category, id, options) => {
    const size = options?.size || 32;
    const subcat = options?.subcategory || 'actions';
    if (category === 'icons') {
      return `/assets/icons/png/${size}/${subcat}/${id}.png`;
    }
    return `/assets/${category}/${size}/${id}.png`;
  }),
  DEFAULT_SIZES: {
    icons: 32,
    items: 64,
    tiles: 64
  }
}));

import { getAssetUrls, getAssetImageUrl, getAssetSubcategory } from '../../lib/assetPathHelper.js';

describe('assetPathHelper', () => {
  describe('icon ID handling via getAssetUrls (Phase 5 - unprefixed IDs)', () => {
    // Post-Phase 5: Icon metadata IDs are now unprefixed to match file names
    it('should use unprefixed zodiac icon ID directly', () => {
      const urls = getAssetUrls('icons', 'aries', { subcategory: 'zodiac', size: 64 });
      expect(urls[0]).toBe('/assets/icons/png/64/zodiac/aries.png');
    });

    it('should use unprefixed menu icon ID directly', () => {
      const urls = getAssetUrls('icons', 'settings', { subcategory: 'menu', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/menu/settings.png');
    });

    it('should use unprefixed action icon ID directly', () => {
      const urls = getAssetUrls('icons', 'attack', { subcategory: 'actions', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/attack.png');
    });

    it('should use unprefixed augment icon ID directly', () => {
      const urls = getAssetUrls('icons', 'fire', { subcategory: 'augments', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/augments/fire.png');
    });

    it('should use unprefixed status icon ID directly', () => {
      const urls = getAssetUrls('icons', 'poison', { subcategory: 'status', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/status/poison.png');
    });

    it('should use unprefixed resource icon ID directly', () => {
      const urls = getAssetUrls('icons', 'gold', { subcategory: 'resources', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/resources/gold.png');
    });

    it('should handle IDs with underscores that are not prefixes', () => {
      const urls = getAssetUrls('icons', 'fire_bolt', { subcategory: 'actions', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/fire_bolt.png');
    });

    it('should handle IDs with compound names', () => {
      const urls = getAssetUrls('icons', 'magic_fire', { subcategory: 'actions', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/magic_fire.png');
    });

    it('should not process non-icon categories', () => {
      const urls = getAssetUrls('items', 'sword', { subcategory: 'weapons', size: 64 });
      expect(urls[0]).toBe('/assets/items/64/sword.png');
    });

    it('should work without subcategory (defaults to actions)', () => {
      const urls = getAssetUrls('icons', 'attack', { size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/attack.png');
    });
  });

  describe('getAssetImageUrl (Phase 5 - unprefixed IDs)', () => {
    it('should use unprefixed zodiac icon ID for grid display', () => {
      const asset = { key: 'aries', _iconCategory: 'zodiac' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/zodiac/aries.png');
    });

    it('should use unprefixed menu icon ID', () => {
      const asset = { id: 'fishing', _iconCategory: 'menu' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/menu/fishing.png');
    });

    it('should use unprefixed action icon ID', () => {
      const asset = { key: 'defend', _iconCategory: 'actions' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/actions/defend.png');
    });

    it('should use key over id when both present', () => {
      const asset = { key: 'settings', id: 'other', _iconCategory: 'menu' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/menu/settings.png');
    });

    it('should fall back to id when key is not present', () => {
      const asset = { id: 'ice', _iconCategory: 'augments' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/augments/ice.png');
    });
  });

  describe('getAssetSubcategory', () => {
    it('should return _iconCategory for icons', () => {
      const asset = { _iconCategory: 'zodiac' };
      expect(getAssetSubcategory(asset, 'icons')).toBe('zodiac');
    });

    it('should fall back to _subcategory for icons', () => {
      const asset = { _subcategory: 'menu' };
      expect(getAssetSubcategory(asset, 'icons')).toBe('menu');
    });

    it('should fall back to subcategory for icons', () => {
      const asset = { subcategory: 'status' };
      expect(getAssetSubcategory(asset, 'icons')).toBe('status');
    });

    it('should fall back to default "actions" for icons without category', () => {
      const asset = {};
      expect(getAssetSubcategory(asset, 'icons')).toBe('actions');
    });

    it('should return _biome for tiles', () => {
      const asset = { _biome: 'forest' };
      expect(getAssetSubcategory(asset, 'tiles')).toBe('forest');
    });

    it('should return _itemCategory for items', () => {
      const asset = { _itemCategory: 'armor' };
      expect(getAssetSubcategory(asset, 'items')).toBe('armor');
    });

    it('should fall back to default "weapons" for items without category', () => {
      const asset = {};
      expect(getAssetSubcategory(asset, 'items')).toBe('weapons');
    });

    it('should return _type for portraits', () => {
      const asset = { _type: 'character' };
      expect(getAssetSubcategory(asset, 'portraits')).toBe('character');
    });

    it('should return _overlayCategory for overlays', () => {
      const asset = { _overlayCategory: 'augments' };
      expect(getAssetSubcategory(asset, 'overlays')).toBe('augments');
    });

    it('should fall back to default "rarity" for overlays without category', () => {
      const asset = {};
      expect(getAssetSubcategory(asset, 'overlays')).toBe('rarity');
    });
  });
});
