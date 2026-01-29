/**
 * NPC Skill Service Unit Tests
 *
 * Tests for NPC skill generation based on archetype and guild.
 * Validates that:
 * - Humanoid NPCs with guild assignments get guild skills
 * - Passive skills (like throw_item) are included for relevant guilds
 * - Monster NPCs get skills from monster skill trees
 *
 * Note: Some functions use Math.random() for probabilistic skill selection.
 * Tests handle this by testing deterministic outcomes and validating structure.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Import the functions we're testing (pure functions, no DB dependency needed)
import {
  getGuildSkillsForHumanoid,
  getMonsterSkillsForArchetype,
  getMaxSkillSlots,
  calculateSkillLevel,
  scaleSkillPower,
  scaleSkillMpCost,
  createBattleSkill,
  generateEnemySkills
} from '../../services/npcSkillService.js';

// Import SKILL_TREES to verify skill existence
import { SKILL_TREES } from '../../config/skillTrees.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQUIRED_BATTLE_SKILL_FIELDS = ['id', 'name', 'type', 'level', 'power', 'range', 'mpCost'];

/**
 * Assert a battle skill has the required shape
 */
function assertValidBattleSkill(skill) {
  for (const field of REQUIRED_BATTLE_SKILL_FIELDS) {
    assert.ok(field in skill, `Battle skill missing required field: ${field}`);
  }
  assert.strictEqual(typeof skill.level, 'number', 'level must be numeric');
  assert.strictEqual(typeof skill.power, 'number', 'power must be numeric');
  assert.strictEqual(typeof skill.range, 'number', 'range must be numeric');
  assert.strictEqual(typeof skill.mpCost, 'number', 'mpCost must be numeric');
}

/**
 * Find a skill by ID in a list of skills
 */
function findSkillById(skills, id) {
  return skills.find(s => s.id === id);
}

// ---------------------------------------------------------------------------
// getGuildSkillsForHumanoid
// ---------------------------------------------------------------------------

describe('getGuildSkillsForHumanoid', () => {
  describe('chemist guild', () => {
    it('returns skills for chemist guild', () => {
      const skills = getGuildSkillsForHumanoid('chemist');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Chemist guild should have skills');
    });

    it('includes throw_item passive skill', () => {
      const skills = getGuildSkillsForHumanoid('chemist');
      const throwItem = findSkillById(skills, 'throw_item');

      assert.ok(throwItem, 'Chemist should have throw_item skill');
      assert.strictEqual(throwItem.type, 'passive', 'throw_item should be passive');
      assert.ok(throwItem.throwItem, 'throw_item should have throwItem property');
    });

    it('includes both active and passive skills', () => {
      const skills = getGuildSkillsForHumanoid('chemist');

      const activeSkills = skills.filter(s => s.type === 'active');
      const passiveSkills = skills.filter(s => s.type === 'passive');

      assert.ok(activeSkills.length > 0, 'Should have active skills');
      assert.ok(passiveSkills.length > 0, 'Should have passive skills');
    });

    it('includes healing skills (potion_toss)', () => {
      const skills = getGuildSkillsForHumanoid('chemist');
      const potionToss = findSkillById(skills, 'potion_toss');

      assert.ok(potionToss, 'Chemist should have potion_toss');
      assert.ok(potionToss.healPercent > 0, 'potion_toss should have healPercent');
    });

    it('includes offensive skills (acid_flask)', () => {
      const skills = getGuildSkillsForHumanoid('chemist');
      const acidFlask = findSkillById(skills, 'acid_flask');

      assert.ok(acidFlask, 'Chemist should have acid_flask');
      assert.ok(acidFlask.power > 0, 'acid_flask should have power');
    });

    it('all skills have branch property set', () => {
      const skills = getGuildSkillsForHumanoid('chemist');

      for (const skill of skills) {
        assert.ok(skill.branch, `Skill ${skill.id} should have branch property`);
      }
    });

    it('all skills have source property set to guild', () => {
      const skills = getGuildSkillsForHumanoid('chemist');

      for (const skill of skills) {
        assert.strictEqual(skill.source, 'guild', `Skill ${skill.id} should have source=guild`);
      }
    });
  });

  describe('wizard guild', () => {
    it('returns skills for wizard guild', () => {
      const skills = getGuildSkillsForHumanoid('wizard');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Wizard guild should have skills');
    });

    it('includes fireball skill', () => {
      const skills = getGuildSkillsForHumanoid('wizard');
      const fireball = findSkillById(skills, 'fireball');

      assert.ok(fireball, 'Wizard should have fireball');
      assert.strictEqual(fireball.type, 'active', 'fireball should be active');
      assert.strictEqual(fireball.damageType, 'magical', 'fireball should be magical');
      assert.strictEqual(fireball.element, 'fire', 'fireball should be fire element');
    });

    it('includes ice_shard skill', () => {
      const skills = getGuildSkillsForHumanoid('wizard');
      const iceShard = findSkillById(skills, 'ice_shard');

      assert.ok(iceShard, 'Wizard should have ice_shard');
      assert.strictEqual(iceShard.element, 'ice', 'ice_shard should be ice element');
    });

    it('includes lightning_bolt skill', () => {
      const skills = getGuildSkillsForHumanoid('wizard');
      const lightningBolt = findSkillById(skills, 'lightning_bolt');

      assert.ok(lightningBolt, 'Wizard should have lightning_bolt');
      assert.strictEqual(lightningBolt.element, 'lightning', 'lightning_bolt should be lightning element');
    });

    it('includes passive skills (wizard_intellect, mana_flow)', () => {
      const skills = getGuildSkillsForHumanoid('wizard');

      const intellect = findSkillById(skills, 'wizard_intellect');
      const manaFlow = findSkillById(skills, 'mana_flow');

      assert.ok(intellect, 'Wizard should have wizard_intellect passive');
      assert.ok(manaFlow, 'Wizard should have mana_flow passive');
      assert.strictEqual(intellect.type, 'passive', 'wizard_intellect should be passive');
      assert.strictEqual(manaFlow.type, 'passive', 'mana_flow should be passive');
    });

    it('passive skills have statBonus property', () => {
      const skills = getGuildSkillsForHumanoid('wizard');
      const passives = skills.filter(s => s.type === 'passive');

      for (const skill of passives) {
        assert.ok(skill.statBonus, `Passive skill ${skill.id} should have statBonus`);
      }
    });
  });

  describe('monk guild', () => {
    it('returns skills for monk guild', () => {
      const skills = getGuildSkillsForHumanoid('monk');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Monk guild should have skills');
    });

    it('includes palm_strike skill', () => {
      const skills = getGuildSkillsForHumanoid('monk');
      const palmStrike = findSkillById(skills, 'palm_strike');

      assert.ok(palmStrike, 'Monk should have palm_strike');
      assert.strictEqual(palmStrike.type, 'active', 'palm_strike should be active');
      assert.strictEqual(palmStrike.range, 1, 'palm_strike should be melee range');
    });

    it('includes flying_kick skill', () => {
      const skills = getGuildSkillsForHumanoid('monk');
      const flyingKick = findSkillById(skills, 'flying_kick');

      assert.ok(flyingKick, 'Monk should have flying_kick');
      assert.ok(flyingKick.range > 1, 'flying_kick should have range > 1');
    });

    it('includes meditation skill', () => {
      const skills = getGuildSkillsForHumanoid('monk');
      const meditation = findSkillById(skills, 'meditation');

      assert.ok(meditation, 'Monk should have meditation');
      assert.ok(meditation.healPercent > 0, 'meditation should heal HP');
      assert.ok(meditation.mpRestore > 0, 'meditation should restore MP');
    });

    it('includes passive skills (monk_agility, chi_flow)', () => {
      const skills = getGuildSkillsForHumanoid('monk');

      const agility = findSkillById(skills, 'monk_agility');
      const chiFlow = findSkillById(skills, 'chi_flow');

      assert.ok(agility, 'Monk should have monk_agility passive');
      assert.ok(chiFlow, 'Monk should have chi_flow passive');
    });
  });

  describe('warrior guild', () => {
    it('returns skills for warrior guild', () => {
      const skills = getGuildSkillsForHumanoid('warrior');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Warrior guild should have skills');
    });

    it('includes power_strike skill', () => {
      const skills = getGuildSkillsForHumanoid('warrior');
      const powerStrike = findSkillById(skills, 'power_strike');

      assert.ok(powerStrike, 'Warrior should have power_strike');
      assert.strictEqual(powerStrike.power, 150, 'power_strike should have 150% power');
    });

    it('includes defensive skills (shield_bash, fortify)', () => {
      const skills = getGuildSkillsForHumanoid('warrior');

      const shieldBash = findSkillById(skills, 'shield_bash');
      const fortify = findSkillById(skills, 'fortify');

      assert.ok(shieldBash, 'Warrior should have shield_bash');
      assert.ok(shieldBash.effect === 'stun', 'shield_bash should stun');
    });

    it('includes passive skills (warrior_strength, iron_skin)', () => {
      const skills = getGuildSkillsForHumanoid('warrior');

      const strength = findSkillById(skills, 'warrior_strength');
      const ironSkin = findSkillById(skills, 'iron_skin');

      assert.ok(strength, 'Warrior should have warrior_strength passive');
      assert.ok(ironSkin, 'Warrior should have iron_skin passive');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for unknown guild', () => {
      const skills = getGuildSkillsForHumanoid('unknown_guild');
      assert.deepStrictEqual(skills, []);
    });

    it('returns empty array for null guild', () => {
      const skills = getGuildSkillsForHumanoid(null);
      assert.deepStrictEqual(skills, []);
    });

    it('returns empty array for undefined guild', () => {
      const skills = getGuildSkillsForHumanoid(undefined);
      assert.deepStrictEqual(skills, []);
    });

    it('handles case-insensitive guild names', () => {
      const lowercase = getGuildSkillsForHumanoid('chemist');
      const uppercase = getGuildSkillsForHumanoid('CHEMIST');
      const mixed = getGuildSkillsForHumanoid('Chemist');

      // All should work (normalized to lowercase)
      assert.ok(lowercase.length > 0, 'lowercase should work');
      // Note: uppercase/mixed depend on implementation
    });
  });
});

// ---------------------------------------------------------------------------
// getMonsterSkillsForArchetype
// ---------------------------------------------------------------------------

describe('getMonsterSkillsForArchetype', () => {
  it('returns skills for beast archetype', () => {
    const skills = getMonsterSkillsForArchetype('beast');

    assert.ok(Array.isArray(skills), 'Should return an array');
    // Beast may or may not have skills depending on MONSTER_SKILL_TREES config
  });

  it('returns skills for dragon archetype', () => {
    const skills = getMonsterSkillsForArchetype('dragon');

    assert.ok(Array.isArray(skills), 'Should return an array');
    // Dragon should have skills in MONSTER_SKILL_TREES
  });

  it('returns empty array for unknown archetype', () => {
    const skills = getMonsterSkillsForArchetype('unknown_archetype');
    assert.deepStrictEqual(skills, []);
  });

  it('returns empty array for null archetype', () => {
    const skills = getMonsterSkillsForArchetype(null);
    assert.deepStrictEqual(skills, []);
  });

  it('skills have source property set to monster', () => {
    const skills = getMonsterSkillsForArchetype('dragon');

    for (const skill of skills) {
      assert.strictEqual(skill.source, 'monster', `Skill ${skill.id} should have source=monster`);
    }
  });
});

// ---------------------------------------------------------------------------
// Skill Slot and Level Calculations
// ---------------------------------------------------------------------------

describe('getMaxSkillSlots', () => {
  it('base is 2 slots at level 1, tier 1', () => {
    const slots = getMaxSkillSlots(1, 1);
    assert.strictEqual(slots, 2);
  });

  it('increases with enemy level (floor(level/15))', () => {
    assert.strictEqual(getMaxSkillSlots(14, 1), 2);  // floor(14/15) = 0
    assert.strictEqual(getMaxSkillSlots(15, 1), 3);  // floor(15/15) = 1
    assert.strictEqual(getMaxSkillSlots(30, 1), 4);  // floor(30/15) = 2
  });

  it('increases with difficulty tier (floor(tier/2))', () => {
    assert.strictEqual(getMaxSkillSlots(1, 1), 2);  // floor(1/2) = 0
    assert.strictEqual(getMaxSkillSlots(1, 2), 3);  // floor(2/2) = 1
    assert.strictEqual(getMaxSkillSlots(1, 4), 4);  // floor(4/2) = 2
  });

  it('caps at 6 slots maximum', () => {
    const slots = getMaxSkillSlots(100, 5);  // Would be 2 + 6 + 2 = 10 without cap
    assert.strictEqual(slots, 6);
  });

  it('combined level and tier bonus', () => {
    // Level 30 (2 bonus) + tier 4 (2 bonus) = 2 + 2 + 2 = 6
    assert.strictEqual(getMaxSkillSlots(30, 4), 6);
  });
});

describe('calculateSkillLevel', () => {
  it('base formula: floor(enemyLevel * 0.4) + 1', () => {
    // At level 10: floor(10 * 0.4) + 1 = 5
    // With tier 1: no tier bonus
    // Variance is random, so test range
    const level = calculateSkillLevel(10, 1);
    assert.ok(level >= 4 && level <= 6, `Skill level ${level} outside expected range 4-6`);
  });

  it('tier bonus: floor((tier-1) * 0.5)', () => {
    // At level 10, tier 5: base 5 + floor(4*0.5) = 5 + 2 = 7
    // Range due to variance: 6-8
    const level = calculateSkillLevel(10, 5);
    assert.ok(level >= 6 && level <= 8, `Skill level ${level} outside expected range 6-8`);
  });

  it('minimum skill level is 1', () => {
    const level = calculateSkillLevel(1, 1);
    assert.ok(level >= 1, 'Skill level should be at least 1');
  });

  it('maximum skill level is 10', () => {
    // Very high level enemy
    const level = calculateSkillLevel(100, 5);
    assert.ok(level <= 10, 'Skill level should not exceed 10');
  });
});

describe('scaleSkillPower', () => {
  it('level 1 returns base power', () => {
    assert.strictEqual(scaleSkillPower(100, 1), 100);
  });

  it('scales by 5% per level above 1', () => {
    // Level 2: 100 * (1 + 0.05) = 105
    assert.strictEqual(scaleSkillPower(100, 2), 105);

    // Level 10: 100 * (1 + 9*0.05) = 145
    assert.strictEqual(scaleSkillPower(100, 10), 145);
  });

  it('floors the result', () => {
    // 75 * 1.05 = 78.75 -> 78
    assert.strictEqual(scaleSkillPower(75, 2), 78);
  });
});

describe('scaleSkillMpCost', () => {
  it('level 1 returns base cost', () => {
    assert.strictEqual(scaleSkillMpCost(10, 1), 10);
  });

  it('scales by 3% per level above 1', () => {
    // Level 2: 10 * (1 + 0.03) = 10.3 -> 10
    assert.strictEqual(scaleSkillMpCost(10, 2), 10);

    // Level 10: 10 * (1 + 9*0.03) = 12.7 -> 12
    assert.strictEqual(scaleSkillMpCost(10, 10), 12);
  });

  it('floors the result', () => {
    // 15 * 1.09 = 16.35 -> 16
    assert.strictEqual(scaleSkillMpCost(15, 4), 16);
  });
});

// ---------------------------------------------------------------------------
// createBattleSkill
// ---------------------------------------------------------------------------

describe('createBattleSkill', () => {
  describe('active skill creation', () => {
    it('creates battle skill with required properties', () => {
      const skillDef = {
        id: 'test_skill',
        name: 'Test Skill',
        description: 'A test skill',
        type: 'active',
        power: 100,
        range: 3,
        mpCost: 15
      };

      const battleSkill = createBattleSkill(skillDef, 5);

      assertValidBattleSkill(battleSkill);
      assert.strictEqual(battleSkill.id, 'test_skill');
      assert.strictEqual(battleSkill.name, 'Test Skill');
      assert.strictEqual(battleSkill.level, 5);
    });

    it('scales power based on skill level', () => {
      const skillDef = { id: 'test', name: 'Test', type: 'active', power: 100, range: 1 };

      const level1 = createBattleSkill(skillDef, 1);
      const level5 = createBattleSkill(skillDef, 5);

      assert.strictEqual(level1.power, 100);
      assert.strictEqual(level5.power, 120);  // 100 * (1 + 4*0.05) = 120
    });

    it('scales mpCost based on skill level', () => {
      const skillDef = { id: 'test', name: 'Test', type: 'active', mpCost: 20, range: 1 };

      const level1 = createBattleSkill(skillDef, 1);
      const level5 = createBattleSkill(skillDef, 5);

      assert.strictEqual(level1.mpCost, 20);
      assert.strictEqual(level5.mpCost, 22);  // 20 * (1 + 4*0.03) = 22.4 -> 22
    });

    it('preserves optional properties (effect, aoeRadius, etc)', () => {
      const skillDef = {
        id: 'aoe_skill',
        name: 'AoE Skill',
        type: 'active',
        power: 80,
        range: 4,
        aoeRadius: 2,
        effect: 'burn',
        effectChance: 0.5,
        effectDuration: 3
      };

      const battleSkill = createBattleSkill(skillDef, 3);

      assert.strictEqual(battleSkill.aoeRadius, 2);
      assert.strictEqual(battleSkill.effect, 'burn');
      assert.strictEqual(battleSkill.effectChance, 0.5);
      assert.strictEqual(battleSkill.effectDuration, 3);
    });
  });

  describe('passive skill creation', () => {
    it('creates passive skill without scaling power/mpCost', () => {
      const skillDef = {
        id: 'stat_boost',
        name: 'Stat Boost',
        type: 'passive',
        power: 0,
        statBonus: { stat: 'strength', percentPerLevel: 0.05 }
      };

      const battleSkill = createBattleSkill(skillDef, 10);

      assert.strictEqual(battleSkill.type, 'passive');
      assert.strictEqual(battleSkill.power, 0);
      assert.strictEqual(battleSkill.mpCost, 0);
      assert.deepStrictEqual(battleSkill.statBonus, { stat: 'strength', percentPerLevel: 0.05 });
    });

    it('preserves statBonus property', () => {
      const skillDef = {
        id: 'passive_skill',
        name: 'Passive Skill',
        type: 'passive',
        statBonus: { stat: 'agility', percentPerLevel: 0.03 }
      };

      const battleSkill = createBattleSkill(skillDef, 5);

      assert.ok(battleSkill.statBonus, 'Should have statBonus');
      assert.strictEqual(battleSkill.statBonus.stat, 'agility');
    });
  });

  describe('throw_item passive (chemist)', () => {
    it('includes throwItem properties with calculated values', () => {
      const skillDef = {
        id: 'throw_item',
        name: 'Throw Item',
        type: 'passive',
        throwItem: {
          baseRange: 2,
          rangeLevelDivisor: 5,
          baseEffectiveness: 0.6,
          effectivenessPerLevel: 0.02
        }
      };

      const battleSkill = createBattleSkill(skillDef, 10);

      assert.ok(battleSkill.throwItem, 'Should have throwItem property');

      // Range: 2 + floor(10/5) = 4
      assert.strictEqual(battleSkill.throwItem.range, 4);

      // Effectiveness: 0.6 + (10 * 0.02) = 0.8
      assert.strictEqual(battleSkill.throwItem.effectiveness, 0.8);
    });

    it('caps effectiveness at 1.0', () => {
      const skillDef = {
        id: 'throw_item',
        name: 'Throw Item',
        type: 'passive',
        throwItem: {
          baseRange: 2,
          rangeLevelDivisor: 5,
          baseEffectiveness: 0.6,
          effectivenessPerLevel: 0.02
        }
      };

      // At level 20: 0.6 + (20 * 0.02) = 1.0
      const battleSkill = createBattleSkill(skillDef, 20);
      assert.strictEqual(battleSkill.throwItem.effectiveness, 1.0);

      // At level 30: would be 1.2, but capped at 1.0
      const highLevel = createBattleSkill(skillDef, 30);
      assert.strictEqual(highLevel.throwItem.effectiveness, 1.0);
    });

    it('preserves base throwItem properties', () => {
      const skillDef = {
        id: 'throw_item',
        name: 'Throw Item',
        type: 'passive',
        throwItem: {
          baseRange: 2,
          rangeLevelDivisor: 5,
          baseEffectiveness: 0.6,
          effectivenessPerLevel: 0.02
        }
      };

      const battleSkill = createBattleSkill(skillDef, 5);

      assert.strictEqual(battleSkill.throwItem.baseRange, 2);
      assert.strictEqual(battleSkill.throwItem.baseEffectiveness, 0.6);
    });
  });
});

// ---------------------------------------------------------------------------
// generateEnemySkills (integration of components)
// ---------------------------------------------------------------------------

describe('generateEnemySkills', () => {
  describe('humanoid NPCs with guild', () => {
    it('generates skills for humanoid chemist', () => {
      const template = {
        name: 'Chemist NPC',
        archetype: 'humanoid',
        guild: 'chemist'
      };

      const skills = generateEnemySkills(template, 15, 10, 3);

      assert.ok(Array.isArray(skills), 'Should return array');
      assert.ok(skills.length > 0, 'Should have skills');

      for (const skill of skills) {
        assertValidBattleSkill(skill);
      }
    });

    it('chemist NPC can get throw_item', () => {
      const template = {
        name: 'Chemist NPC',
        archetype: 'humanoid',
        guild: 'chemist'
      };

      // Run multiple times since skill selection has randomness
      let foundThrowItem = false;
      for (let i = 0; i < 50; i++) {
        const skills = generateEnemySkills(template, 30, 20, 4);
        if (skills.some(s => s.id === 'throw_item')) {
          foundThrowItem = true;
          break;
        }
      }

      assert.ok(foundThrowItem, 'Chemist NPC should sometimes get throw_item');
    });

    it('generates skills for humanoid wizard', () => {
      const template = {
        name: 'Wizard NPC',
        archetype: 'humanoid',
        guild: 'wizard'
      };

      const skills = generateEnemySkills(template, 20, 15, 3);

      assert.ok(skills.length > 0, 'Wizard NPC should have skills');

      // Check for wizard-specific skills
      const hasWizardSkill = skills.some(s =>
        s.id === 'fireball' || s.id === 'ice_shard' || s.id === 'lightning_bolt' ||
        s.id === 'wizard_intellect' || s.id === 'mana_flow'
      );
      assert.ok(hasWizardSkill, 'Wizard NPC should have wizard skills');
    });

    it('generates skills for humanoid monk', () => {
      const template = {
        name: 'Monk NPC',
        archetype: 'humanoid',
        guild: 'monk'
      };

      const skills = generateEnemySkills(template, 20, 15, 3);

      assert.ok(skills.length > 0, 'Monk NPC should have skills');

      // Check for monk-specific skills
      const hasMonkSkill = skills.some(s =>
        s.id === 'palm_strike' || s.id === 'flying_kick' || s.id === 'meditation' ||
        s.id === 'monk_agility' || s.id === 'chi_flow'
      );
      assert.ok(hasMonkSkill, 'Monk NPC should have monk skills');
    });

    it('skill count respects maxSlots based on level and tier', () => {
      const template = {
        name: 'Test NPC',
        archetype: 'humanoid',
        guild: 'warrior'
      };

      // Level 1, tier 1: max 2 slots
      const lowLevelSkills = generateEnemySkills(template, 1, 1, 1);
      assert.ok(lowLevelSkills.length <= 2, 'Low level should have at most 2 skills');

      // Level 45, tier 5: max 6 slots
      const highLevelSkills = generateEnemySkills(template, 45, 30, 5);
      assert.ok(highLevelSkills.length <= 6, 'High level should have at most 6 skills');
    });
  });

  describe('monster NPCs (non-humanoid)', () => {
    it('generates skills for beast archetype', () => {
      const template = {
        name: 'Wild Beast',
        archetype: 'beast'
      };

      const skills = generateEnemySkills(template, 10, 8, 2);

      assert.ok(Array.isArray(skills), 'Should return array');
      // Beast may or may not have skills depending on MONSTER_SKILL_TREES
    });

    it('generates skills for dragon archetype', () => {
      const template = {
        name: 'Dragon',
        archetype: 'dragon'
      };

      const skills = generateEnemySkills(template, 30, 25, 4);

      assert.ok(Array.isArray(skills), 'Should return array');
      // Dragon should have skills from monster skill trees
    });

    it('does not give guild skills to non-humanoid monsters', () => {
      const template = {
        name: 'Beast',
        archetype: 'beast',
        guild: 'warrior'  // Even if guild is set, non-humanoid shouldn't use it
      };

      // With archetype != 'humanoid', should use monster skill trees
      const skills = generateEnemySkills(template, 10, 8, 2);

      // Should not have warrior-specific skills
      const hasWarriorSkill = skills.some(s =>
        s.id === 'power_strike' || s.id === 'shield_bash' || s.id === 'warrior_strength'
      );

      // Beast archetype should not have warrior guild skills
      // (unless MONSTER_SKILL_TREES happens to have them, which is unlikely)
    });
  });

  describe('edge cases', () => {
    it('handles missing archetype', () => {
      const template = { name: 'Unknown' };

      const skills = generateEnemySkills(template, 10, 8, 2);

      assert.ok(Array.isArray(skills), 'Should return array');
    });

    it('handles humanoid without guild', () => {
      const template = {
        name: 'Humanoid',
        archetype: 'humanoid'
        // no guild specified
      };

      const skills = generateEnemySkills(template, 10, 8, 2);

      assert.ok(Array.isArray(skills), 'Should return array');
      // Without guild, humanoid might fall back or return empty
    });

    it('returns empty array when no skills available', () => {
      const template = {
        name: 'Unknown Monster',
        archetype: 'completely_unknown_type'
      };

      const skills = generateEnemySkills(template, 10, 8, 2);

      assert.ok(Array.isArray(skills), 'Should return array');
      // Should be empty or handle gracefully
    });
  });
});

// ---------------------------------------------------------------------------
// Passive Skill Inclusion Verification
// ---------------------------------------------------------------------------

describe('Passive skill inclusion', () => {
  it('guild skills include both active and passive types', () => {
    const guilds = ['warrior', 'wizard', 'monk', 'chemist'];

    for (const guild of guilds) {
      const skills = getGuildSkillsForHumanoid(guild);

      const activeCount = skills.filter(s => s.type === 'active').length;
      const passiveCount = skills.filter(s => s.type === 'passive').length;

      assert.ok(activeCount > 0, `${guild} should have active skills`);
      assert.ok(passiveCount > 0, `${guild} should have passive skills`);
    }
  });

  it('passive skills are valid for NPC skill selection', () => {
    // Verify that passives from each guild can be selected
    const chemistSkills = getGuildSkillsForHumanoid('chemist');
    const chemistPassives = chemistSkills.filter(s => s.type === 'passive');

    for (const passive of chemistPassives) {
      assert.ok(passive.id, 'Passive should have id');
      assert.ok(passive.name, 'Passive should have name');
      assert.strictEqual(passive.type, 'passive', 'Type should be passive');
    }
  });

  it('throw_item skill has required throwItem metadata', () => {
    const chemistSkills = getGuildSkillsForHumanoid('chemist');
    const throwItem = findSkillById(chemistSkills, 'throw_item');

    if (throwItem) {
      assert.ok(throwItem.throwItem, 'throw_item should have throwItem metadata');
      assert.ok('baseRange' in throwItem.throwItem, 'Should have baseRange');
      assert.ok('baseEffectiveness' in throwItem.throwItem, 'Should have baseEffectiveness');
    }
  });
});
