import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { caches: {} };

const { AssetLoader } = await import('../AssetLoader.js');

describe('AssetLoader BattleMapV2 exact assets', () => {
  it('refuses class-only player lookups that could reach legacy artwork', async () => {
    const loader = new AssetLoader();
    loader.loadImage = async () => assert.fail('legacy class-only path must not be loaded');

    assert.equal(await loader.loadCharacterSprite('warrior', 'idle'), null);
    assert.equal(loader.getCharacterSprite('warrior', 'idle'), null);
  });

  it('requires exact player identities for preloading and rejects missing sheets', async () => {
    const loader = new AssetLoader();

    await assert.rejects(
      loader.preloadCharacter('warrior'),
      /canonical race\/gender\/class player identity/
    );

    loader.loadCharacterSprite = async (_character, animation) =>
      animation === 'idle' ? { animation } : null;
    await assert.rejects(
      loader.preloadCharacter(
        { race: 'human', gender: 'female', class: 'wizard' },
        { animations: ['idle', 'walk'] }
      ),
      /canonical player sprite.*failed to preload/
    );
  });

  it('resolves only the exact catalogued floor variant', () => {
    const loader = new AssetLoader();
    const expected = { id: 'forest-grass-2' };
    loader.cache.set(
      '/assets/sprites/terrain/forest/grass_2.webp',
      expected
    );
    loader.cache.set(
      '/assets/sprites/terrain/mountain/grass_2.webp',
      { id: 'wrong-palette' }
    );

    assert.equal(
      loader.getBattleMapV2Asset(
        'forest:floor:grass',
        { variantIndex: 2 }
      ),
      expected
    );
    assert.equal(
      loader.getBattleMapV2Asset(
        'forest:floor:grass',
        { variantIndex: 1 }
      ),
      null
    );
    assert.throws(
      () => loader.getBattleMapV2Asset(
        'forest:floor:grass',
        { variantIndex: 4 }
      ),
      /Invalid variant/
    );
  });

  it('fails closed for unknown and cross-palette asset keys', () => {
    const loader = new AssetLoader();

    assert.throws(
      () => loader.getBattleMapV2Asset('desert:floor:grass'),
      /Unknown V2 render asset capability/
    );
    assert.throws(
      () => loader.getBattleMapV2Asset('forest:floor:lava'),
      /Unknown V2 render asset capability/
    );
    assert.throws(
      () => loader.getBattleMapV2Asset(
        'castle:floor:stone',
        { expectedPalette: 'forest' }
      ),
      /belongs to palette castle, expected forest/
    );
  });

  it('returns deterministic code-native dirt and semantic overlays', () => {
    const loader = new AssetLoader();

    assert.deepEqual(
      loader.getBattleMapV2Asset('forest:floor:dirt'),
      {
        type: 'code-native',
        assetKey: 'forest:floor:dirt',
        renderer: 'terrain-floor',
        color: '#765632',
        accentColor: '#9a7544'
      }
    );
    assert.deepEqual(
      loader.getBattleMapV2Asset('forest:transition:shore'),
      {
        type: 'code-native',
        assetKey: 'forest:transition:shore',
        renderer: 'semantic-transition',
        color: '#d8c690',
        alpha: 0.72,
        lineWidth: 3
      }
    );
    assert.deepEqual(
      loader.getBattleMapV2Asset(
        'forest:decoration-family:ground-cover',
        { variantIndex: 3 }
      ),
      {
        type: 'code-native',
        assetKey: 'forest:decoration-family:ground-cover',
        renderer: 'nonblocking-decoration',
        color: '#496b35',
        accentColor: '#829a50',
        alpha: 0.82,
        radius: 2
      }
    );
  });

  it('resolves exact directional slope and stair sprites without fallback', () => {
    const loader = new AssetLoader();
    const slope = { id: 'slope' };
    const stairs = { id: 'stairs' };
    loader.cache.set(
      '/assets/sprites/terrain/forest/slope_forest_east_1.webp',
      slope
    );
    loader.cache.set(
      '/assets/sprites/terrain/forest/stairs_forest_east_2.webp',
      stairs
    );
    loader.cache.set(
      '/assets/sprites/terrain/base/slope_base_west_1.webp',
      { id: 'fallback' }
    );

    assert.equal(
      loader.getSlopeSprite(
        'forest',
        'east',
        1,
        { kind: 'slope', exact: true }
      ),
      slope
    );
    assert.equal(
      loader.getSlopeSprite(
        'forest',
        'e',
        2,
        { kind: 'stairs', exact: true }
      ),
      stairs
    );
    assert.equal(
      loader.getSlopeSprite(
        'forest',
        'west',
        1,
        { kind: 'slope', exact: true }
      ),
      null
    );
    assert.throws(
      () => loader.getSlopeSprite(
        'forest',
        'north',
        2,
        { kind: 'slope', exact: true }
      ),
      /Unknown V2 render asset capability/
    );
  });

  it('selects exact obstacle-family members deterministically', () => {
    const loader = new AssetLoader();
    const expected = { id: 'stalagmite' };
    loader.cache.set(
      '/assets/obstacles/rocks/stalagmite.webp',
      expected
    );

    const key = 'forest:obstacle-family:rock';
    const selectionKey = 'obstacle:rock:4:7';

    assert.equal(
      loader.getBattleMapV2Asset(key, { selectionKey }),
      expected
    );
    assert.equal(
      loader.getBattleMapV2Asset(key, {
        variantIndex: 0,
        selectionKey
      }),
      null
    );
  });

  it('preloads every exact slope and stair direction', async () => {
    const loader = new AssetLoader();
    const calls = [];
    const floorCalls = [];
    loader.getSpriteBiome = () => 'forest';
    loader.loadTile = async () => ({});
    loader.loadWallTexture = async () => ({});
    loader.loadBattleMapV2Asset = async (...args) => {
      floorCalls.push(args);
      return {};
    };
    loader.loadSlopeSprite = async (...args) => {
      calls.push(args);
      return {};
    };

    await loader.preloadTerrainSet('forest', { includeWalls: false });

    assert.deepEqual(calls, [
      ['forest', 'north', 1, { kind: 'slope', exact: true }],
      ['forest', 'north', 2, { kind: 'stairs', exact: true }],
      ['forest', 'south', 1, { kind: 'slope', exact: true }],
      ['forest', 'south', 2, { kind: 'stairs', exact: true }],
      ['forest', 'east', 1, { kind: 'slope', exact: true }],
      ['forest', 'east', 2, { kind: 'stairs', exact: true }],
      ['forest', 'west', 1, { kind: 'slope', exact: true }],
      ['forest', 'west', 2, { kind: 'stairs', exact: true }]
    ]);
    assert.ok(floorCalls.some(
      ([key, options]) =>
        key === 'forest:floor:grass' && options.variantIndex === 3
    ));
    assert.ok(floorCalls.some(
      ([key, options]) =>
        key === 'forest:floor:dirt' && options.variantIndex === 0
    ));
  });

  it('preloads V2 assets from the recipe palette, not the enemy alias', async () => {
    const loader = new AssetLoader();
    const floorCalls = [];
    const connectionCalls = [];
    loader.getSpriteBiome = () => 'forest';
    loader.loadTile = async () => ({});
    loader.loadWallTexture = async () => ({});
    loader.loadBattleMapV2Asset = async (...args) => {
      floorCalls.push(args);
      return {};
    };
    loader.loadSlopeSprite = async (...args) => {
      connectionCalls.push(args);
      return {};
    };

    await loader.preloadTerrainSet('vampiric_crypt', {
      includeWalls: false
    });

    assert.ok(floorCalls
      .filter(([key]) => key.includes(':floor:'))
      .every(([key]) => key.startsWith('castle:floor:')));
    assert.ok(floorCalls.some(([key]) => key === 'castle:face:stone'));
    assert.ok(connectionCalls.every(([palette]) => palette === 'castle'));
  });

  it('preloads persisted V2 obstacle families by exact key', async () => {
    const loader = new AssetLoader();
    const calls = [];
    loader.loadBattleMapV2Asset = async (...args) => {
      calls.push(args);
      return {};
    };
    loader.loadObstacle = async () => {
      throw new Error('V2 must not use legacy obstacle paths');
    };

    await loader.preloadObstacles({
      obstacles: [{
        id: 'obstacle:rock:4:7',
        kind: 'rock',
        assetKey: 'forest:obstacle-family:rock'
      }]
    });

    assert.deepEqual(calls, [[
      'forest:obstacle-family:rock',
      { selectionKey: 'obstacle:rock:4:7' }
    ]]);
  });

  it('rejects when a required exact V2 terrain asset cannot be decoded', async () => {
    const loader = new AssetLoader();
    loader.getSpriteBiome = () => 'forest';
    // Legacy misses remain permissible because V2 rendering does not consume
    // them as authoritative map records.
    loader.loadTile = async () => null;
    loader.loadWallTexture = async () => null;
    loader.loadBattleMapV2Asset = async assetKey =>
      assetKey === 'forest:face:stone' ? null : {};
    loader.loadSlopeSprite = async () => ({});

    await loader.preloadTerrainSet('forest', { includeWalls: false });
    await assert.rejects(
      loader.preloadTerrainSet('forest', {
        includeWalls: false,
        requireV2Assets: true
      }),
      /required V2 terrain asset.*failed to load/
    );
  });

  it('rejects missing exact V2 obstacle assets only in required mode', async () => {
    const loader = new AssetLoader();
    loader.loadBattleMapV2Asset = async () => null;
    const obstacles = [{
      id: 'obstacle:rock:4:7',
      kind: 'rock',
      assetKey: 'forest:obstacle-family:rock'
    }];

    await loader.preloadObstacles({ obstacles });
    await assert.rejects(
      loader.preloadObstacles({
        obstacles,
        requireV2Assets: true
      }),
      /required V2 map asset.*failed to load/
    );
  });

  it('rejects a required V2 manifest record without an asset key', async () => {
    const loader = new AssetLoader();

    await assert.rejects(
      loader.preloadObstacles({
        obstacles: [{ id: 'obstacle:rock:4:7', kind: 'rock' }],
        requireV2Assets: true
      }),
      /missing an assetKey/
    );
  });
});
