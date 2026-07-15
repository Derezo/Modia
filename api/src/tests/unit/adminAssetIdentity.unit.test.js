import test from 'node:test';
import assert from 'node:assert/strict';

import { findAssetById } from '../../routes/admin/shared.js';

const floor = {
  key: 'shared_key',
  _biome: 'forest',
  _tileCategory: 'floors',
  _sourceFile: 'floors/forest.json',
};
const slope = {
  key: 'shared_key',
  _biome: 'forest',
  _tileCategory: 'slopes',
  _sourceFile: 'slopes/forest.json',
};
const castleFloor = {
  key: 'shared_key',
  _biome: 'castle',
  _tileCategory: 'floors',
  _sourceFile: 'floors/castle.json',
};

const data = {
  assets: [floor, slope, castleFloor],
  byId: { shared_key: castleFloor },
};

test('findAssetById scopes tile keys by biome and tile category', () => {
  assert.equal(
    findAssetById(data, 'tiles', 'shared_key', {
      biome: 'forest',
      tileCategory: 'slopes',
    }),
    slope
  );

  assert.equal(
    findAssetById(data, 'tiles', 'shared_key', {
      biome: 'castle',
      tileCategory: 'floors',
    }),
    castleFloor
  );
});

test('findAssetById keeps sourceFile as the most precise scope', () => {
  assert.equal(
    findAssetById(data, 'tiles', 'shared_key', {
      biome: 'castle',
      tileCategory: 'floors',
      sourceFile: 'slopes/forest.json',
    }),
    slope
  );
});
