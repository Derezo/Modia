/**
 * Battle Unit Factory Unit Tests
 *
 * Tests for creating player and enemy battle units with various configurations.
 * Covers stat calculations, equipment bonuses, archetype scaling, and utility functions.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createPlayerBattleUnit,
  createEnemyBattleUnit,
  normalizeUnit,
  isPlayerUnit,
  isEnemyUnit,
  getOppositeType,
  isAlive,
  getAliveUnitsOfType
} from '../../services/battleUnitFactory.js';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock character with default values
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock character object
 */
function createMockCharacter(overrides = {}) {
  return {
    id: 1,
    user_id: 100,
    name: 'TestHero',
    race: 'human',
    gender: 'male',
    class: 'warrior',
    level: 10,
    hp_current: 100,
    hp_max: 120,
    mp_current: 30,
    mp_max: 40,
    strength: 25,
    intelligence: 12,
    agility: 15,
    vitality: 20,
    luck: 10,
    // Equipment bonuses (default to 0)
    equip_hp: 0,
    equip_mp: 0,
    equip_strength: 0,
    equip_intelligence: 0,
    equip_agility: 0,
    equip_vitality: 0,
    equip_luck: 0,
    equip_attack: 0,
    equip_defense: 0,
    equip_magic_attack: 0,
    equip_magic_defense: 0,
    equipment: null,
    ...overrides
  };
}

/**
 * Create a mock character with full equipment bonuses
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock character with equipment
 */
function createMockCharacterWithEquipment(overrides = {}) {
  return createMockCharacter({
    equip_hp: 50,
    equip_mp: 20,
    equip_strength: 10,
    equip_intelligence: 5,
    equip_agility: 8,
    equip_vitality: 12,
    equip_luck: 3,
    equip_attack: 25,
    equip_defense: 15,
    equip_magic_attack: 10,
    equip_magic_defense: 8,
    equipment: {
      weapon: { id: 1, name: 'Iron Sword', attack: 25 },
      armor: { id: 2, name: 'Iron Armor', defense: 15 }
    },
    ...overrides
  });
}

/**
 * Create a mock enemy template
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock enemy template
 */
function createMockEnemyTemplate(overrides = {}) {
  return {
    id: 101,
    name: 'Forest Wolf',
    sprite_id: 'wolf_1',
    archetype: 'beast',
    enemy_class: null,
    guild: null,
    guild_level: 1,
    base_hp: 50,
    base_mp: 10,
    base_strength: 15,
    base_intelligence: 5,
    base_agility: 20,
    base_vitality: null,
    base_luck: null,
    attack_bonus: 5,
    defense_bonus: 3,
    magic_attack_bonus: 0,
    magic_defense_bonus: 2,
    movement: 4,
    attack_range: 1,
    ai_type: 'aggressive',
    abilities: ['bite', 'pounce'],
    experience_reward: 50,
    gold_reward_min: 10,
    gold_reward_max: 25,
    drop_table: { 'wolf_pelt': 0.3 },
    ...overrides
  };
}

/**
 * Create a mock formation position
 * @param {number} tileX
 * @param {number} tileY
 * @returns {Object} Formation position object
 */
function createMockFormation(tileX = 5, tileY = 12) {
  return { tileX, tileY };
}

// ============================================================================
// createPlayerBattleUnit Tests
// ============================================================================

describe('createPlayerBattleUnit', () => {
  describe('basic unit creation', () => {
    it('creates a player unit with correct identity fields', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.id, 1);
      assert.strictEqual(unit.type, 'player');
      assert.strictEqual(unit.name, 'TestHero');
      assert.strictEqual(unit.class, 'warrior');
      assert.strictEqual(unit.level, 10);
      assert.strictEqual(unit.race, 'human');
      assert.strictEqual(unit.gender, 'male');
      assert.strictEqual(unit.ownerId, 100);
    });

    it('sets default position when no formation provided', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.tileX, 3);
      assert.strictEqual(unit.tileY, 15);
    });

    it('uses formation position when provided', () => {
      const character = createMockCharacter();
      const formation = createMockFormation(7, 10);
      const unit = createPlayerBattleUnit(character, formation);

      assert.strictEqual(unit.tileX, 7);
      assert.strictEqual(unit.tileY, 10);
    });

    it('uses custom default position from options', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character, null, [], {
        defaultX: 2,
        defaultY: 8
      });

      assert.strictEqual(unit.tileX, 2);
      assert.strictEqual(unit.tileY, 8);
    });

    it('initializes turn system fields correctly', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.ct, 0);
      assert.strictEqual(unit.moveUsed, false);
      assert.strictEqual(unit.actUsed, false);
      assert.strictEqual(unit.turnPhase, 'ready');
      assert.strictEqual(unit.hasActed, false);
    });

    it('initializes status arrays and objects', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.ok(Array.isArray(unit.statusEffects));
      assert.strictEqual(unit.statusEffects.length, 0);
      assert.ok(typeof unit.skillCooldowns === 'object');
      assert.strictEqual(Object.keys(unit.skillCooldowns).length, 0);
    });
  });

  describe('stat calculations with equipment', () => {
    it('applies equipment HP and MP bonuses', () => {
      const character = createMockCharacterWithEquipment();
      const unit = createPlayerBattleUnit(character);

      // maxHp = hp_max + equip_hp = 120 + 50 = 170
      assert.strictEqual(unit.maxHp, 170);
      // maxMp = mp_max + equip_mp = 40 + 20 = 60
      assert.strictEqual(unit.maxMp, 60);
    });

    it('applies equipment stat bonuses', () => {
      const character = createMockCharacterWithEquipment();
      const unit = createPlayerBattleUnit(character);

      // strength = base + equip = 25 + 10 = 35
      assert.strictEqual(unit.strength, 35);
      // intelligence = base + equip = 12 + 5 = 17
      assert.strictEqual(unit.intelligence, 17);
      // agility = base + equip = 15 + 8 = 23
      assert.strictEqual(unit.agility, 23);
      // vitality = base + equip = 20 + 12 = 32
      assert.strictEqual(unit.vitality, 32);
      // luck = base + equip = 10 + 3 = 13
      assert.strictEqual(unit.luck, 13);
    });

    it('applies equipment combat bonuses', () => {
      const character = createMockCharacterWithEquipment();
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.attack, 25);
      assert.strictEqual(unit.defense, 15);
      assert.strictEqual(unit.magicAttack, 10);
      assert.strictEqual(unit.magicDefense, 8);
    });

    it('handles missing equipment bonuses gracefully', () => {
      const character = createMockCharacter({
        equip_strength: undefined,
        equip_attack: null
      });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.strength, 25); // Base only
      assert.strictEqual(unit.attack, 0);    // Default 0
    });

    it('preserves equipment object for rendering', () => {
      const character = createMockCharacterWithEquipment();
      const unit = createPlayerBattleUnit(character);

      assert.ok(unit.equipment);
      assert.strictEqual(unit.equipment.weapon.name, 'Iron Sword');
    });
  });

  describe('HP/MP current values', () => {
    it('uses hp_current when available', () => {
      const character = createMockCharacter({
        hp_current: 80,
        hp_max: 120
      });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.hp, 80);
    });

    it('falls back to hp_max when hp_current is null', () => {
      const character = createMockCharacter({
        hp_current: null,
        hp_max: 120
      });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.hp, 120);
    });

    it('handles mp_current same as hp_current', () => {
      const character = createMockCharacter({
        mp_current: null,
        mp_max: 40
      });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.mp, 40);
    });
  });

  describe('class-based movement', () => {
    it('assigns correct movement for warrior class', () => {
      const character = createMockCharacter({ class: 'warrior' });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.movement, 3);
    });

    it('assigns correct movement for monk class (higher mobility)', () => {
      const character = createMockCharacter({ class: 'monk' });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.movement, 4);
    });

    it('defaults to 3 for unknown class', () => {
      const character = createMockCharacter({ class: 'unknown_class' });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.movement, 3);
    });

    it('handles null class gracefully', () => {
      const character = createMockCharacter({ class: null });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.movement, 3);
    });
  });

  describe('skills and abilities', () => {
    it('assigns skills array from parameter', () => {
      const character = createMockCharacter();
      const skills = [
        { id: 'power_strike', name: 'Power Strike', power: 150 },
        { id: 'guard', name: 'Guard', effect: 'defense_up' }
      ];
      const unit = createPlayerBattleUnit(character, null, skills);

      assert.strictEqual(unit.skills.length, 2);
      assert.strictEqual(unit.skills[0].id, 'power_strike');
    });

    it('defaults to empty skills array', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.ok(Array.isArray(unit.skills));
      assert.strictEqual(unit.skills.length, 0);
    });
  });

  describe('traits and zodiac abilities', () => {
    it('assigns traits from options', () => {
      const character = createMockCharacter();
      const traits = [
        { id: 1, name: 'Iron Will', effectType: 'physical_damage', effectValue: 0.1 }
      ];
      const unit = createPlayerBattleUnit(character, null, [], { traits });

      assert.strictEqual(unit.traits.length, 1);
      assert.strictEqual(unit.traits[0].name, 'Iron Will');
    });

    it('assigns zodiac abilities from options', () => {
      const character = createMockCharacter();
      const zodiacAbilities = [
        { id: 'aries_charge', name: 'Aries Charge', power: 200 }
      ];
      const unit = createPlayerBattleUnit(character, null, [], { zodiacAbilities });

      assert.strictEqual(unit.zodiacAbilities.length, 1);
      assert.strictEqual(unit.zodiacAbilities[0].id, 'aries_charge');
      assert.ok(Array.isArray(unit.usedZodiacAbilities));
      assert.strictEqual(unit.usedZodiacAbilities.length, 0);
    });

    it('defaults to empty arrays for traits and zodiac abilities', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.ok(Array.isArray(unit.traits));
      assert.strictEqual(unit.traits.length, 0);
      assert.ok(Array.isArray(unit.zodiacAbilities));
      assert.strictEqual(unit.zodiacAbilities.length, 0);
    });
  });

  describe('death save tracking', () => {
    it('initializes deathSaveUsed to false', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.deathSaveUsed, false);
    });
  });

  describe('default attack range', () => {
    it('sets default attack range to 1 (melee)', () => {
      const character = createMockCharacter();
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.attackRange, 1);
    });
  });

  describe('level defaults', () => {
    it('defaults level to 1 when missing', () => {
      const character = createMockCharacter({ level: undefined });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.level, 1);
    });
  });

  describe('gender defaults', () => {
    it('defaults gender to other when missing', () => {
      const character = createMockCharacter({ gender: undefined });
      const unit = createPlayerBattleUnit(character);

      assert.strictEqual(unit.gender, 'other');
    });
  });
});

// ============================================================================
// createEnemyBattleUnit Tests
// ============================================================================

describe('createEnemyBattleUnit', () => {
  describe('basic enemy creation', () => {
    it('creates enemy unit with correct identity fields', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.id, 'enemy_0');
      assert.strictEqual(unit.type, 'enemy');
      assert.strictEqual(unit.name, 'Forest Wolf');
      assert.strictEqual(unit.templateId, 101);
      assert.strictEqual(unit.enemyId, 'wolf_1');
    });

    it('generates unique IDs based on index', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };

      const unit0 = createEnemyBattleUnit(template, 10, 2, 0, position);
      const unit1 = createEnemyBattleUnit(template, 10, 2, 1, position);
      const unit2 = createEnemyBattleUnit(template, 10, 2, 2, position);

      assert.strictEqual(unit0.id, 'enemy_0');
      assert.strictEqual(unit1.id, 'enemy_1');
      assert.strictEqual(unit2.id, 'enemy_2');
    });

    it('sets position correctly', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 15, y: 8 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.tileX, 15);
      assert.strictEqual(unit.tileY, 8);
    });
  });

  describe('archetype-based stat scaling', () => {
    it('scales stats using beast archetype growth rates', () => {
      const template = createMockEnemyTemplate({ archetype: 'beast' });
      const position = { x: 10, y: 5 };
      // Party level 10, tier 2 (1.0 multiplier)
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      // Beast growth: hp: 8, str: 2.5, int: 1, agi: 2, vit: 2, lck: 0.5
      // Tier 2 = 1.0 multiplier, enemyLevel = 10
      // scaledHp = floor((50 + 10*8) * 1.0) = 130
      assert.strictEqual(unit.maxHp, 130);
      // scaledStrength = floor((15 + 10*2.5) * 1.0) = 40
      assert.strictEqual(unit.strength, 40);
    });

    it('scales stats using dragon archetype growth rates', () => {
      const template = createMockEnemyTemplate({
        archetype: 'dragon',
        base_hp: 100,
        base_strength: 30
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      // Dragon growth: hp: 20, str: 3
      // scaledHp = floor((100 + 10*20) * 1.0) = 300
      assert.strictEqual(unit.maxHp, 300);
      // scaledStrength = floor((30 + 10*3) * 1.0) = 60
      assert.strictEqual(unit.strength, 60);
    });

    it('scales stats using undead archetype growth rates', () => {
      const template = createMockEnemyTemplate({
        archetype: 'undead',
        base_hp: 80
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      // Undead growth: hp: 15
      // scaledHp = floor((80 + 10*15) * 1.0) = 230
      assert.strictEqual(unit.maxHp, 230);
    });

    it('falls back to monster archetype for unknown type', () => {
      const template = createMockEnemyTemplate({ archetype: 'unknown_archetype' });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      // Monster growth (fallback): hp: 10
      // scaledHp = floor((50 + 10*10) * 1.0) = 150
      assert.strictEqual(unit.maxHp, 150);
    });

    it('handles missing archetype by using monster default', () => {
      const template = createMockEnemyTemplate({ archetype: null });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      // Should use 'monster' archetype
      assert.strictEqual(unit.archetype, 'monster');
    });
  });

  describe('difficulty tier scaling', () => {
    it('applies tier 1 multiplier (0.8) for easy areas', () => {
      const template = createMockEnemyTemplate({ base_hp: 100 });
      const position = { x: 10, y: 5 };
      // Party level 10, tier 1
      const unit = createEnemyBattleUnit(template, 10, 1, 0, position);

      // enemyLevel = floor(10 * 0.8) = 8
      // Beast hp growth = 8, scaledHp = floor((100 + 8*8) * 0.8) = floor(132.8) = 132
      assert.strictEqual(unit.level, 8);
    });

    it('applies tier 3 multiplier (1.25) for hard content', () => {
      const template = createMockEnemyTemplate({ base_hp: 100 });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 3, 0, position);

      // enemyLevel = floor(10 * 1.25) = 12
      assert.strictEqual(unit.level, 12);
    });

    it('applies tier 5 multiplier (2.0) for boss encounters', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 5, 0, position);

      // enemyLevel = floor(10 * 2.0) = 20
      assert.strictEqual(unit.level, 20);
    });

    it('defaults to tier 2 (1.0) for unknown tier', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 99, 0, position);

      // Unknown tier defaults to 1.0
      assert.strictEqual(unit.level, 10);
    });

    it('ensures minimum level of 1', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      // Party level 1, tier 1 (0.8) = 0.8, floor = 0, max(1, 0) = 1
      const unit = createEnemyBattleUnit(template, 1, 1, 0, position);

      assert.strictEqual(unit.level, 1);
    });
  });

  describe('combat bonus scaling', () => {
    it('scales attack and defense bonuses by tier', () => {
      const template = createMockEnemyTemplate({
        attack_bonus: 10,
        defense_bonus: 8
      });
      const position = { x: 10, y: 5 };
      // Tier 3 = 1.25 multiplier
      const unit = createEnemyBattleUnit(template, 10, 3, 0, position);

      // attack = floor(10 * 1.25) = 12
      assert.strictEqual(unit.attack, 12);
      // defense = floor(8 * 1.25) = 10
      assert.strictEqual(unit.defense, 10);
    });

    it('handles missing combat bonuses', () => {
      const template = createMockEnemyTemplate({
        attack_bonus: null,
        defense_bonus: undefined,
        magic_attack_bonus: null,
        magic_defense_bonus: null
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.attack, 0);
      assert.strictEqual(unit.defense, 0);
      assert.strictEqual(unit.magicAttack, 0);
      assert.strictEqual(unit.magicDefense, 0);
    });
  });

  describe('enemy class determination', () => {
    it('uses enemy_class when provided', () => {
      const template = createMockEnemyTemplate({ enemy_class: 'berserker' });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.class, 'berserker');
    });

    it('uses guild when enemy_class is not provided', () => {
      const template = createMockEnemyTemplate({
        enemy_class: null,
        guild: 'warrior'
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.class, 'warrior');
    });

    it('defaults to monster when neither class nor guild provided', () => {
      const template = createMockEnemyTemplate({
        enemy_class: null,
        guild: null
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.class, 'monster');
    });
  });

  describe('movement and range', () => {
    it('uses template movement when provided', () => {
      const template = createMockEnemyTemplate({ movement: 5 });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.movement, 5);
    });

    it('falls back to class-based movement', () => {
      const template = createMockEnemyTemplate({
        movement: null,
        enemy_class: 'monk'
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.movement, 4); // Monk has 4 movement
    });

    it('uses template attack range', () => {
      const template = createMockEnemyTemplate({ attack_range: 3 });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.attackRange, 3);
    });

    it('defaults attack range to 1', () => {
      const template = createMockEnemyTemplate({ attack_range: null });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.attackRange, 1);
    });
  });

  describe('skills and consumables', () => {
    it('uses skills from options when provided', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const skills = [{ id: 'custom_skill', power: 200 }];
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position, { skills });

      assert.strictEqual(unit.skills.length, 1);
      assert.strictEqual(unit.skills[0].id, 'custom_skill');
    });

    it('falls back to template abilities when no skills provided', () => {
      const template = createMockEnemyTemplate({
        abilities: ['bite', 'howl']
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.deepStrictEqual(unit.skills, ['bite', 'howl']);
    });

    it('assigns consumables from options', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const consumables = [{ id: 'potion', quantity: 2 }];
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position, { consumables });

      assert.strictEqual(unit.consumables.length, 1);
      assert.strictEqual(unit.consumables[0].id, 'potion');
    });
  });

  describe('AI type and special states', () => {
    it('uses template ai_type', () => {
      const template = createMockEnemyTemplate({ ai_type: 'defensive' });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.aiType, 'defensive');
    });

    it('defaults ai_type to aggressive', () => {
      const template = createMockEnemyTemplate({ ai_type: null });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.aiType, 'aggressive');
    });

    it('sets isHidden true for ambush AI', () => {
      const template = createMockEnemyTemplate({ ai_type: 'ambush' });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.isHidden, true);
      assert.strictEqual(unit.hasAmbushed, false);
    });

    it('sets isHidden false for non-ambush AI', () => {
      const template = createMockEnemyTemplate({ ai_type: 'aggressive' });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.isHidden, false);
    });
  });

  describe('rewards scaling', () => {
    it('scales experience reward by tier', () => {
      const template = createMockEnemyTemplate({ experience_reward: 100 });
      const position = { x: 10, y: 5 };
      // Tier 3 = 1.25 multiplier
      const unit = createEnemyBattleUnit(template, 10, 3, 0, position);

      assert.strictEqual(unit.experienceReward, 125);
    });

    it('scales gold rewards by tier', () => {
      const template = createMockEnemyTemplate({
        gold_reward_min: 10,
        gold_reward_max: 20
      });
      const position = { x: 10, y: 5 };
      // Tier 3 = 1.25 multiplier
      const unit = createEnemyBattleUnit(template, 10, 3, 0, position);

      assert.strictEqual(unit.goldRewardMin, 12);
      assert.strictEqual(unit.goldRewardMax, 25);
    });

    it('handles missing reward values', () => {
      const template = createMockEnemyTemplate({
        experience_reward: null,
        gold_reward_min: null,
        gold_reward_max: null
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.experienceReward, 10); // Default 10
      assert.strictEqual(unit.goldRewardMin, 1);     // Default 1
      assert.strictEqual(unit.goldRewardMax, 10);    // Default 10
    });
  });

  describe('biome assignment', () => {
    it('uses biome from options', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position, { biome: 'desert' });

      assert.strictEqual(unit.biome, 'desert');
    });

    it('defaults biome to forest', () => {
      const template = createMockEnemyTemplate();
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.biome, 'forest');
    });
  });

  describe('guild metadata', () => {
    it('preserves guild and guild_level from template', () => {
      const template = createMockEnemyTemplate({
        guild: 'warrior',
        guild_level: 3
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.guild, 'warrior');
      assert.strictEqual(unit.guildLevel, 3);
    });

    it('defaults guild_level to 1', () => {
      const template = createMockEnemyTemplate({
        guild: null,
        guild_level: null
      });
      const position = { x: 10, y: 5 };
      const unit = createEnemyBattleUnit(template, 10, 2, 0, position);

      assert.strictEqual(unit.guild, null);
      assert.strictEqual(unit.guildLevel, 1);
    });
  });
});

// ============================================================================
// normalizeUnit Tests
// ============================================================================

describe('normalizeUnit', () => {
  it('preserves existing properties', () => {
    const unit = {
      id: 1,
      name: 'TestUnit',
      hp: 100,
      class: 'warrior'
    };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.id, 1);
    assert.strictEqual(normalized.name, 'TestUnit');
    assert.strictEqual(normalized.hp, 100);
  });

  it('adds missing statusEffects array', () => {
    const unit = { id: 1, class: 'warrior' };
    const normalized = normalizeUnit(unit);

    assert.ok(Array.isArray(normalized.statusEffects));
    assert.strictEqual(normalized.statusEffects.length, 0);
  });

  it('adds missing skillCooldowns object', () => {
    const unit = { id: 1, class: 'warrior' };
    const normalized = normalizeUnit(unit);

    assert.ok(typeof normalized.skillCooldowns === 'object');
    assert.strictEqual(Object.keys(normalized.skillCooldowns).length, 0);
  });

  it('uses skills when present, falls back to abilities', () => {
    const unitWithSkills = { skills: ['a', 'b'] };
    const unitWithAbilities = { abilities: ['c', 'd'] };
    const unitWithBoth = { skills: ['e'], abilities: ['f'] };

    assert.deepStrictEqual(normalizeUnit(unitWithSkills).skills, ['a', 'b']);
    assert.deepStrictEqual(normalizeUnit(unitWithAbilities).skills, ['c', 'd']);
    assert.deepStrictEqual(normalizeUnit(unitWithBoth).skills, ['e']); // skills takes priority
  });

  it('defaults skills to empty array', () => {
    const unit = { id: 1 };
    const normalized = normalizeUnit(unit);

    assert.deepStrictEqual(normalized.skills, []);
  });

  it('assigns class-based movement when missing', () => {
    const warrior = { class: 'warrior' };
    const monk = { class: 'monk' };
    const unknown = { class: 'unknown' };

    assert.strictEqual(normalizeUnit(warrior).movement, 3);
    assert.strictEqual(normalizeUnit(monk).movement, 4);
    assert.strictEqual(normalizeUnit(unknown).movement, 3); // Default
  });

  it('preserves existing movement', () => {
    const unit = { class: 'warrior', movement: 5 };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.movement, 5);
  });

  it('defaults attackRange to 1', () => {
    const unit = { id: 1 };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.attackRange, 1);
  });

  it('defaults move and act flags to false', () => {
    const unit = { id: 1 };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.moveUsed, false);
    assert.strictEqual(normalized.actUsed, false);
  });

  it('preserves existing move and act flags', () => {
    const unit = { moveUsed: true, actUsed: true };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.moveUsed, true);
    assert.strictEqual(normalized.actUsed, true);
  });

  it('defaults turnPhase to ready', () => {
    const unit = { id: 1 };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.turnPhase, 'ready');
  });

  it('defaults combat bonuses to 0', () => {
    const unit = { id: 1 };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.attack, 0);
    assert.strictEqual(normalized.defense, 0);
    assert.strictEqual(normalized.magicAttack, 0);
    assert.strictEqual(normalized.magicDefense, 0);
  });

  it('preserves existing combat bonuses', () => {
    const unit = { attack: 25, defense: 15 };
    const normalized = normalizeUnit(unit);

    assert.strictEqual(normalized.attack, 25);
    assert.strictEqual(normalized.defense, 15);
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('isPlayerUnit', () => {
  it('returns true for player type', () => {
    assert.strictEqual(isPlayerUnit({ type: 'player' }), true);
  });

  it('returns false for enemy type', () => {
    assert.strictEqual(isPlayerUnit({ type: 'enemy' }), false);
  });

  it('returns false for other types', () => {
    assert.strictEqual(isPlayerUnit({ type: 'npc' }), false);
    assert.strictEqual(isPlayerUnit({ type: null }), false);
  });
});

describe('isEnemyUnit', () => {
  it('returns true for enemy type', () => {
    assert.strictEqual(isEnemyUnit({ type: 'enemy' }), true);
  });

  it('returns false for player type', () => {
    assert.strictEqual(isEnemyUnit({ type: 'player' }), false);
  });

  it('returns false for other types', () => {
    assert.strictEqual(isEnemyUnit({ type: 'npc' }), false);
    assert.strictEqual(isEnemyUnit({ type: null }), false);
  });
});

describe('getOppositeType', () => {
  it('returns enemy for player', () => {
    assert.strictEqual(getOppositeType('player'), 'enemy');
  });

  it('returns player for enemy', () => {
    assert.strictEqual(getOppositeType('enemy'), 'player');
  });

  it('returns player for unknown types (default behavior)', () => {
    assert.strictEqual(getOppositeType('npc'), 'player');
    assert.strictEqual(getOppositeType(null), 'player');
  });
});

describe('isAlive', () => {
  it('returns true when hp > 0', () => {
    assert.strictEqual(isAlive({ hp: 100 }), true);
    assert.strictEqual(isAlive({ hp: 1 }), true);
  });

  it('returns false when hp <= 0', () => {
    assert.strictEqual(isAlive({ hp: 0 }), false);
    assert.strictEqual(isAlive({ hp: -10 }), false);
  });
});

describe('getAliveUnitsOfType', () => {
  const units = [
    { id: 1, type: 'player', hp: 100 },
    { id: 2, type: 'player', hp: 0 },
    { id: 3, type: 'player', hp: 50 },
    { id: 4, type: 'enemy', hp: 80 },
    { id: 5, type: 'enemy', hp: 0 },
    { id: 6, type: 'enemy', hp: -10 }
  ];

  it('returns only alive player units', () => {
    const result = getAliveUnitsOfType(units, 'player');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 1);
    assert.strictEqual(result[1].id, 3);
  });

  it('returns only alive enemy units', () => {
    const result = getAliveUnitsOfType(units, 'enemy');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 4);
  });

  it('returns empty array when no units match', () => {
    const allDead = [
      { id: 1, type: 'player', hp: 0 },
      { id: 2, type: 'enemy', hp: 0 }
    ];
    const result = getAliveUnitsOfType(allDead, 'player');

    assert.strictEqual(result.length, 0);
  });

  it('returns empty array for empty input', () => {
    const result = getAliveUnitsOfType([], 'player');

    assert.strictEqual(result.length, 0);
  });

  it('returns empty array for unknown type', () => {
    const result = getAliveUnitsOfType(units, 'npc');

    assert.strictEqual(result.length, 0);
  });
});
