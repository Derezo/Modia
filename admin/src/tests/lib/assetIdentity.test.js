import { describe, expect, it } from 'vitest';

import {
  getAssetRawId,
  getAssetSelectionId,
  getSelectedAssets,
  groupTileAssetsByScope,
} from '../../lib/assetIdentity.js';

const tiles = [
  {
    key: 'grass_0',
    _biome: 'forest',
    _tileCategory: 'floors',
    _sourceFile: 'floors/forest.json',
  },
  {
    key: 'grass_0',
    _biome: 'castle',
    _tileCategory: 'floors',
    _sourceFile: 'floors/castle.json',
  },
  {
    key: 'grass_0',
    _biome: 'forest',
    _tileCategory: 'slopes',
    _sourceFile: 'slopes/forest.json',
  },
  {
    id: 'stone_0',
    _biome: 'forest',
    _tileCategory: 'floors',
    _sourceFile: 'floors/forest.json',
  },
];

describe('assetIdentity', () => {
  it('keeps repeated tile keys independent across biome and tile category', () => {
    const selectionIds = tiles.slice(0, 3).map((asset) =>
      getAssetSelectionId(asset, 'tiles')
    );

    expect(new Set(selectionIds).size).toBe(3);
    expect(selectionIds[0]).toContain('forest');
    expect(selectionIds[0]).toContain('floors');
  });

  it('resolves a composite selection without selecting raw-ID siblings', () => {
    const selectedId = getAssetSelectionId(tiles[1], 'tiles');

    expect(getSelectedAssets(tiles, [selectedId], 'tiles')).toEqual([tiles[1]]);
  });

  it('groups tile API calls by biome and tile category using raw IDs', () => {
    expect(groupTileAssetsByScope(tiles)).toEqual([
      {
        biome: 'forest',
        subcategory: 'floors',
        assetIds: ['grass_0', 'stone_0'],
      },
      {
        biome: 'castle',
        subcategory: 'floors',
        assetIds: ['grass_0'],
      },
      {
        biome: 'forest',
        subcategory: 'slopes',
        assetIds: ['grass_0'],
      },
    ]);
  });

  it('keeps raw API IDs separate from scoped selection IDs', () => {
    expect(getAssetRawId(tiles[0])).toBe('grass_0');
    expect(getAssetSelectionId(tiles[0], 'tiles')).not.toBe('grass_0');
  });
});
