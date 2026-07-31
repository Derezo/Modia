import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BATTLE_MAP_ECOLOGY_CONTEXT_VERSION,
  createBattleMapEcologyContext,
  extractBattleMapTerrainSubtype,
  loadBattleMapEcologyNode,
  resolveBattleMapEcologyProfile
} from '../../services/battle/BattleMapEcologyContext.js';
import {
  generateBattleMap
} from '../../services/battle/battleMapGenerationService.js';
import {
  BATTLE_MAP_V3_SUPPORTED_THEMES
} from '../../../../shared/battleMap/BattleMapV3Resolvers.js';
import {
  assertBattleMapV3SelectionQuery
} from '../../../../shared/battleMap/BattleMapV3Selector.js';

describe('BattleMap ecology context', () => {
  it('resolves the approved regional forest profiles deterministically', () => {
    const expected = new Map([
      ['human', 'forest-heartlands-woodland'],
      ['elf', 'forest-sylvan-ancient-grove'],
      ['vampire', 'forest-shadowmere-gloomwood'],
      ['dwarf', 'forest-iron-depths-borderwood']
    ]);

    for (const [regionRace, ecologyProfile] of expected) {
      assert.equal(resolveBattleMapEcologyProfile({
        nodeType: 'forest',
        regionRace
      }), ecologyProfile);
    }
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'forest',
      regionRace: null
    }), 'forest-temperate-woodland');
  });

  it('resolves every supported theme to an authoritative ecology profile', () => {
    const defaults = new Map([
      ['forest', 'forest-temperate-woodland'],
      ['cave', 'cave-limestone'],
      ['mountain', 'mountain-granite'],
      ['bridge', 'bridge-stone-crossing'],
      ['castle', 'castle-fortress'],
      ['palace', 'palace-grand-palace'],
      ['dungeon', 'dungeon-subterranean'],
      ['swamp', 'swamp-wetlands'],
      ['volcano', 'volcano-caldera'],
      ['plains', 'plains-grassland'],
      ['arena', 'arena-coliseum'],
      ['guild', 'guild-guildhall'],
      ['elven_grove', 'forest-sylvan-ancient-grove'],
      ['dwarven_mine', 'cave-iron-depths-granite'],
      ['vampiric_crypt', 'cave-shadowmere-crypt'],
      ['orcish_warcamp', 'mountain-bloodplains-red-crag'],
      ['human_ruins', 'human-heartlands-ruins']
    ]);

    assert.equal(BATTLE_MAP_V3_SUPPORTED_THEMES.length, 16);
    assert.deepEqual(
      new Set(defaults.keys()),
      new Set([...BATTLE_MAP_V3_SUPPORTED_THEMES, 'palace'])
    );
    for (const [nodeType, ecologyProfile] of defaults) {
      assert.equal(resolveBattleMapEcologyProfile({ nodeType }), ecologyProfile);
    }
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'not-a-supported-theme'
    }), null);
  });

  it('preserves regional geology overrides without introducing scene shape', () => {
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'cave',
      regionRace: 'dwarf'
    }), 'cave-iron-depths-granite');
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'cave',
      regionRace: 'vampire'
    }), 'cave-shadowmere-crypt');
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'cave',
      regionRace: 'human'
    }), 'cave-limestone');
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'mountain',
      regionRace: 'orc'
    }), 'mountain-bloodplains-red-crag');
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'mountain',
      regionRace: 'elf'
    }), 'mountain-granite');
    assert.equal(resolveBattleMapEcologyProfile({
      nodeType: 'palace',
      regionRace: null
    }), 'palace-grand-palace');
  });

  it('extracts only typed terrain subtypes from persisted features', () => {
    assert.equal(extractBattleMapTerrainSubtype([
      'dense trees',
      { category: 'terrain', subtype: 'Shadow Grove' }
    ]), 'shadow-grove');
    assert.equal(extractBattleMapTerrainSubtype({
      displayTerrain: 'Ancient Glade'
    }), 'ancient-glade');
    assert.equal(extractBattleMapTerrainSubtype(['gloomwood']), null);
  });

  it('normalizes and freezes the stable node/region context contract', () => {
    const context = createBattleMapEcologyContext({
      id: '42',
      name: '  Elder Trail  ',
      node_type: 'Forest',
      difficulty_tier: '3',
      local_seed: '-913',
      features: [{ terrain_subtype: 'Moonlit Grove' }],
      region_id: '7',
      region_race: 'Elf',
      region_dominant_terrain: 'Ancient Forest'
    });

    assert.deepEqual(context, {
      version: BATTLE_MAP_ECOLOGY_CONTEXT_VERSION,
      node: {
        id: 42,
        name: 'Elder Trail',
        type: 'forest',
        difficultyTier: 3,
        localSeed: -913,
        terrainSubtype: 'moonlit-grove'
      },
      region: {
        id: 7,
        race: 'elf',
        dominantTerrain: 'ancient-forest'
      },
      ecologyProfile: 'forest-sylvan-ancient-grove'
    });
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.node), true);
    assert.equal(Object.isFrozen(context.region), true);
  });

  it('keeps missing optional world fields nullable and uses coarse fallback', () => {
    const context = createBattleMapEcologyContext({
      node_type: 'forest'
    });

    assert.deepEqual(context.node, {
      id: null,
      name: null,
      type: 'forest',
      difficultyTier: null,
      localSeed: null,
      terrainSubtype: null
    });
    assert.deepEqual(context.region, {
      id: null,
      race: null,
      dominantTerrain: null
    });
    assert.equal(context.ecologyProfile, 'forest-temperate-woodland');
  });

  it('loads all ecology fields through the supplied transaction executor', async () => {
    const calls = [];
    const source = {
      id: 42,
      name: 'Elder Trail',
      node_type: 'forest',
      difficulty_tier: 3,
      local_seed: 913,
      features: [],
      region_id: 7,
      region_race: 'elf',
      region_dominant_terrain: 'forest'
    };
    const loaded = await loadBattleMapEcologyNode(async (text, params) => {
      calls.push({ text, params });
      return { rows: [source] };
    }, 42);

    assert.deepEqual(calls[0].params, [42]);
    for (const field of [
      'wn.id',
      'wn.node_type',
      'wn.name',
      'wn.difficulty_tier',
      'wn.local_seed',
      'wn.features',
      'wn.region_id',
      'wr.race',
      'wr.dominant_terrain'
    ]) {
      assert.match(calls[0].text, new RegExp(field.replace('.', '\\.')));
    }
    assert.equal(loaded.node, source);
    assert.equal(
      loaded.ecologyContext.ecologyProfile,
      'forest-sylvan-ancient-grove'
    );
  });

  it('returns null when the trusted node no longer exists', async () => {
    const loaded = await loadBattleMapEcologyNode(
      async () => ({ rows: [] }),
      404
    );
    assert.equal(loaded, null);
  });

  it('projects trusted world context into the closed scalar V3 selection query', async () => {
    const ecologyContext = createBattleMapEcologyContext({
      id: 42,
      name: 'Elder Trail',
      node_type: 'forest',
      difficulty_tier: 3,
      local_seed: 913,
      region_id: 7,
      region_race: 'elf'
    });
    const sentinel = new Error('selection probe complete');
    let receivedQuery = null;

    await assert.rejects(
      generateBattleMap({
        terrainSeed: 123,
        nodeType: 'forest',
        mode: 'pve',
        difficultyTier: 3,
        playerCount: 1,
        enemyCount: 1,
        ecologyContext
      }, {
        selectV3: async query => {
          assertBattleMapV3SelectionQuery(query);
          receivedQuery = query;
          throw sentinel;
        }
      }),
      error => error === sentinel
    );

    assert.equal(Object.hasOwn(receivedQuery, 'ecologyContext'), false);
    assert.equal(
      receivedQuery.ecologyProfile,
      'forest-sylvan-ancient-grove'
    );
  });

  it('forwards non-null guild and Coliseum selector-v2 query profiles without inventing world context', async () => {
    const receivedQueries = [];
    const sentinel = new Error('selection probe complete');

    for (const request of [
      {
        terrainSeed: 401,
        nodeType: 'guild',
        mode: 'guild',
        guildTier: 2,
        playerCount: 1,
        enemyCount: 5
      },
      {
        terrainSeed: 402,
        nodeType: 'arena',
        mode: 'pvp_coliseum',
        competitiveBand: '1v1',
        playerCount: 1,
        enemyCount: 1
      },
      {
        terrainSeed: 403,
        nodeType: 'palace',
        mode: 'pve',
        difficultyTier: 5,
        playerCount: 1,
        enemyCount: 1
      }
    ]) {
      await assert.rejects(
        generateBattleMap(request, {
          selectV3: async query => {
            assertBattleMapV3SelectionQuery(query);
            receivedQueries.push(query);
            throw sentinel;
          }
        }),
        error => error === sentinel
      );
    }

    assert.equal(receivedQueries[0].ecologyProfile, 'guild-guildhall');
    assert.equal(receivedQueries[1].ecologyProfile, 'arena-coliseum');
    assert.equal(receivedQueries[2].theme, 'castle');
    assert.equal(receivedQueries[2].ecologyProfile, 'palace-grand-palace');
    assert.ok(receivedQueries.every(
      query => Object.hasOwn(query, 'ecologyContext') === false
    ));
  });
});
