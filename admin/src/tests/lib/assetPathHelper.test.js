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
  describe('icon ID normalization via getAssetUrls', () => {
    it('should strip category prefix from zodiac icon IDs', () => {
      const urls = getAssetUrls('icons', 'zodiac_aries', { subcategory: 'zodiac', size: 64 });
      expect(urls[0]).toBe('/assets/icons/png/64/zodiac/aries.png');
    });

    it('should strip category prefix from menu icon IDs', () => {
      const urls = getAssetUrls('icons', 'menu_settings', { subcategory: 'menu', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/menu/settings.png');
    });

    it('should strip category prefix from action icon IDs', () => {
      const urls = getAssetUrls('icons', 'action_attack', { subcategory: 'actions', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/attack.png');
    });

    it('should strip category prefix from augment icon IDs', () => {
      const urls = getAssetUrls('icons', 'augment_fire', { subcategory: 'augments', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/augments/fire.png');
    });

    it('should strip category prefix from status icon IDs', () => {
      const urls = getAssetUrls('icons', 'status_poisoned', { subcategory: 'status', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/status/poisoned.png');
    });

    it('should strip category prefix from resource icon IDs', () => {
      const urls = getAssetUrls('icons', 'resource_gold', { subcategory: 'resources', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/resources/gold.png');
    });

    it('should not strip non-matching prefixes', () => {
      const urls = getAssetUrls('icons', 'fire_bolt', { subcategory: 'actions', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/fire_bolt.png');
    });

    it('should pass through IDs without subcategory prefix', () => {
      const urls = getAssetUrls('icons', 'attack', { subcategory: 'actions', size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/attack.png');
    });

    it('should not normalize non-icon categories', () => {
      const urls = getAssetUrls('items', 'weapons_sword', { subcategory: 'weapons', size: 64 });
      expect(urls[0]).toBe('/assets/items/64/weapons_sword.png');
    });

    it('should not normalize when subcategory is not provided', () => {
      const urls = getAssetUrls('icons', 'zodiac_aries', { size: 32 });
      expect(urls[0]).toBe('/assets/icons/png/32/actions/zodiac_aries.png');
    });
  });

  describe('getAssetImageUrl', () => {
    it('should normalize zodiac icon IDs for grid display', () => {
      const asset = { key: 'zodiac_aries', _iconCategory: 'zodiac' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/zodiac/aries.png');
    });

    it('should normalize menu icon IDs', () => {
      const asset = { id: 'menu_fishing', _iconCategory: 'menu' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/menu/fishing.png');
    });

    it('should normalize action icon IDs', () => {
      const asset = { key: 'action_defend', _iconCategory: 'actions' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/actions/defend.png');
    });

    it('should use key over id when both present', () => {
      const asset = { key: 'menu_settings', id: 'menu_other', _iconCategory: 'menu' };
      const url = getAssetImageUrl(asset, 'icons');
      expect(url).toBe('/assets/icons/png/32/menu/settings.png');
    });

    it('should fall back to id when key is not present', () => {
      const asset = { id: 'augment_ice', _iconCategory: 'augments' };
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
