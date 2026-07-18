import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEnemyBattleUnit,
  createPlayerBattleUnit,
  normalizeUnit
} from '../../services/battleUnitFactory.js';
import {
  createDiscipleUnit,
  createGuildmasterUnit
} from '../../services/guildmasterBattleService.js';
import {
  createBattleVisualIdentity,
  withBattleVisualIdentity,
  withBattleStateVisualIdentities
} from '../../services/battle/visualIdentityService.js';

function assertJsonSafe(value) {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function createCharacter() {
  return {
    id: 42,
    user_id: 7,
    name: 'Aster',
    race: 'Elf',
    gender: 'Female',
    class: 'Wizard',
    level: 12,
    hp_current: 80,
    hp_max: 100,
    mp_current: 50,
    mp_max: 60,
    strength: 8,
    intelligence: 24,
    agility: 14,
    vitality: 10,
    luck: 12
  };
}

function createEnemyTemplate() {
  return {
    id: 88,
    name: 'Giant Spider',
    sprite_id: 'giant_spider',
    archetype: 'beast',
    base_hp: 45,
    base_mp: 20,
    base_strength: 10,
    base_intelligence: 5,
    base_agility: 9,
    base_vitality: 5,
    base_luck: 8,
    spawn_node_types: ['cave', 'forest']
  };
}

describe('canonical battle visual identity', () => {
  it('describes player artwork independently of the encounter unit id', () => {
    const unit = createPlayerBattleUnit(createCharacter());

    assert.deepEqual(unit.visualIdentity, {
      kind: 'player',
      id: 42,
      race: 'elf',
      gender: 'female',
      class: 'wizard'
    });
    assertJsonSafe(unit.visualIdentity);
  });

  it('backfills normalized player aliases from the canonical nested DTO', () => {
    const normalized = withBattleVisualIdentity({
      id: 42,
      type: 'player',
      race: 'human',
      gender: 'male',
      class: 'warrior',
      visualIdentity: {
        kind: 'player',
        id: 42,
        race: 'Dwarf',
        gender: 'Other',
        class: 'Wizard'
      }
    });

    assert.equal(normalized.race, 'dwarf');
    assert.equal(normalized.gender, 'other');
    assert.equal(normalized.class, 'wizard');
  });

  it('gives normal enemies a stable primary biome and every legacy alias', () => {
    const unit = createEnemyBattleUnit(
      createEnemyTemplate(),
      10,
      2,
      0,
      { x: 5, y: 5 },
      { biome: 'cave' }
    );

    assert.deepEqual(unit.visualIdentity, {
      kind: 'npc',
      id: 88,
      visualId: 'giant_spider',
      primaryBiome: 'forest'
    });
    assert.equal(unit.biome, 'cave', 'encounter biome remains available');
    assert.equal(unit.primaryBiome, 'forest');
    assert.equal(unit.enemyId, 'giant_spider');
    assert.equal(unit.sprite_id, 'giant_spider');
    assert.equal(unit.spriteId, 'giant_spider');
    assertJsonSafe(unit.visualIdentity);
  });

  it('backfills canonical identity and aliases on legacy battle state', () => {
    const unit = normalizeUnit({
      id: 'old_enemy_1',
      type: 'enemy',
      class: 'humanoid',
      spriteId: 'bridge_bandit',
      biome: 'mountain'
    });

    assert.deepEqual(unit.visualIdentity, {
      kind: 'npc',
      id: 'old_enemy_1',
      visualId: 'bridge_bandit',
      primaryBiome: 'bridge'
    });
    assert.equal(unit.enemyId, 'bridge_bandit');
    assert.equal(unit.sprite_id, 'bridge_bandit');
    assert.equal(unit.spriteId, 'bridge_bandit');
  });

  it('propagates guildmaster sprite ids into canonical and legacy fields', () => {
    const guildmaster = createGuildmasterUnit({
      id: 501,
      guild_class: 'wizard',
      name: 'Seraphina',
      title: 'Archmage',
      sprite_id: 'guildmaster_wizard',
      base_level: 25,
      base_hp: 500,
      base_mp: 200,
      base_strength: 10,
      base_intelligence: 40,
      base_agility: 15,
      base_vitality: 15,
      skills: ['fireball'],
      phases: []
    }, 20);

    assert.deepEqual(guildmaster.visualIdentity, {
      kind: 'npc',
      id: 501,
      visualId: 'guildmaster_wizard',
      primaryBiome: 'guild'
    });
    assert.equal(guildmaster.enemyId, 'guildmaster_wizard');
    assert.equal(guildmaster.sprite_id, 'guildmaster_wizard');
    assert.equal(guildmaster.spriteId, 'guildmaster_wizard');
    assert.equal(guildmaster.skills[0].element, 'fire');
    assertJsonSafe(guildmaster.visualIdentity);
  });

  it('assigns disciples a deterministic visual id through every alias', () => {
    const disciple = createDiscipleUnit('warrior', 20, 1);

    assert.deepEqual(disciple.visualIdentity, {
      kind: 'npc',
      id: 'disciple_warrior',
      visualId: 'disciple_warrior',
      primaryBiome: 'guild'
    });
    assert.equal(disciple.enemyId, 'disciple_warrior');
    assert.equal(disciple.sprite_id, 'disciple_warrior');
    assert.equal(disciple.spriteId, 'disciple_warrior');
    assertJsonSafe(disciple.visualIdentity);
  });

  it('constructs detached JSON-safe identities without mutating callers', () => {
    const legacy = {
      id: 'enemy_9',
      type: 'enemy',
      enemyId: 'gray_wolf',
      biome: 'mountain'
    };
    const identity = createBattleVisualIdentity(legacy);
    const normalized = withBattleVisualIdentity(legacy);

    assert.equal(identity.primaryBiome, 'forest');
    assert.equal(normalized.primaryBiome, 'forest');
    assert.equal('visualIdentity' in legacy, false);
    assertJsonSafe(identity);
  });

  it('does not let encounter-specific aliases override a registered canonical home', () => {
    const castle = createBattleVisualIdentity({
      id: 'dark_knight_castle',
      type: 'enemy',
      sprite_id: 'dark_knight',
      biome: 'castle'
    }, { primaryBiome: 'castle' });
    const cave = createBattleVisualIdentity({
      id: 'dark_knight_cave',
      type: 'enemy',
      sprite_id: 'dark_knight',
      biome: 'cave'
    });

    assert.equal(castle.visualId, cave.visualId);
    assert.equal(castle.primaryBiome, 'palace');
    assert.equal(cave.primaryBiome, 'palace');
  });

  it('backfills visual DTOs on persisted rejoin state without mutation', () => {
    const persisted = {
      turn: 4,
      units: [{
        id: 'legacy_enemy',
        type: 'enemy',
        sprite_id: 'stone_golem',
        biome: 'mountain'
      }]
    };
    const normalized = withBattleStateVisualIdentities(persisted);

    assert.notEqual(normalized, persisted);
    assert.notEqual(normalized.units, persisted.units);
    assert.equal('visualIdentity' in persisted.units[0], false);
    assert.deepEqual(normalized.units[0].visualIdentity, {
      kind: 'npc',
      id: 'legacy_enemy',
      visualId: 'stone_golem',
      primaryBiome: 'cave'
    });
  });
});
