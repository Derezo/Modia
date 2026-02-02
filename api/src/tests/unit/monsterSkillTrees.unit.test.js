/**
 * Monster Skill Trees Unit Tests
 *
 * Tests for monster archetype skill lookup functions.
 * All pure functions with no database dependencies.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert';
import {
  MONSTER_SKILL_TREES,
  getMonsterSkillDefinition,
  getAllMonsterSkills,
  getHighPrioritySkills
} from '../../config/monsterSkillTrees.js';

describe('Monster Skill Trees - Data Validation', () => {
  describe('MONSTER_SKILL_TREES structure', () => {
    it('should have all expected archetypes', () => {
      const expectedArchetypes = [
        'beast', 'dragon', 'undead', 'elemental',
        'humanoid', 'construct', 'demon', 'insect', 'plant'
      ];

      for (const archetype of expectedArchetypes) {
        assert.ok(MONSTER_SKILL_TREES[archetype], `Should have ${archetype} archetype`);
      }
    });

    it('each archetype should have name and description', () => {
      for (const [key, archetype] of Object.entries(MONSTER_SKILL_TREES)) {
        assert.ok(archetype.name, `${key} should have name`);
        assert.ok(archetype.description, `${key} should have description`);
      }
    });

    it('each archetype should have branches', () => {
      for (const [key, archetype] of Object.entries(MONSTER_SKILL_TREES)) {
        assert.ok(Array.isArray(archetype.branches), `${key} should have branches array`);
        assert.ok(archetype.branches.length > 0, `${key} should have at least one branch`);
      }
    });

    it('each branch should have name and skills', () => {
      for (const [archetypeKey, archetype] of Object.entries(MONSTER_SKILL_TREES)) {
        for (const branch of archetype.branches) {
          assert.ok(branch.name, `${archetypeKey} branch should have name`);
          assert.ok(Array.isArray(branch.skills), `${archetypeKey}/${branch.name} should have skills array`);
          assert.ok(branch.skills.length > 0, `${archetypeKey}/${branch.name} should have at least one skill`);
        }
      }
    });
  });

  describe('skill definitions', () => {
    it('all skills should have required properties', () => {
      for (const [archetypeKey, archetype] of Object.entries(MONSTER_SKILL_TREES)) {
        for (const branch of archetype.branches) {
          for (const skill of branch.skills) {
            assert.ok(skill.id, `Skill in ${archetypeKey}/${branch.name} missing id`);
            assert.ok(skill.name, `Skill ${skill.id} missing name`);
            assert.ok(skill.type, `Skill ${skill.id} missing type`);
            assert.ok(typeof skill.priority === 'number', `Skill ${skill.id} missing priority`);
            assert.ok(skill.description, `Skill ${skill.id} missing description`);
          }
        }
      }
    });

    it('active skills should have range and mpCost', () => {
      for (const archetype of Object.values(MONSTER_SKILL_TREES)) {
        for (const branch of archetype.branches) {
          for (const skill of branch.skills) {
            if (skill.type === 'active') {
              assert.ok(typeof skill.range === 'number', `Skill ${skill.id} missing range`);
              assert.ok(typeof skill.mpCost === 'number', `Skill ${skill.id} missing mpCost`);
            }
          }
        }
      }
    });

    it('damage skills should have power and damageType', () => {
      for (const archetype of Object.values(MONSTER_SKILL_TREES)) {
        for (const branch of archetype.branches) {
          for (const skill of branch.skills) {
            // Skip non-damage skills (buffs, debuffs, heals)
            if (skill.power && skill.power > 0) {
              assert.ok(skill.damageType || skill.healPercent,
                `Skill ${skill.id} with power should have damageType or be healing`);
            }
          }
        }
      }
    });

    it('skill IDs should be unique within archetype', () => {
      for (const [archetypeKey, archetype] of Object.entries(MONSTER_SKILL_TREES)) {
        const seenIds = new Set();
        for (const branch of archetype.branches) {
          for (const skill of branch.skills) {
            assert.ok(!seenIds.has(skill.id),
              `Duplicate skill ID ${skill.id} in ${archetypeKey}`);
            seenIds.add(skill.id);
          }
        }
      }
    });

    it('priority should be between 1 and 10', () => {
      for (const archetype of Object.values(MONSTER_SKILL_TREES)) {
        for (const branch of archetype.branches) {
          for (const skill of branch.skills) {
            assert.ok(skill.priority >= 1 && skill.priority <= 10,
              `Skill ${skill.id} priority ${skill.priority} out of range [1, 10]`);
          }
        }
      }
    });
  });
});

describe('Monster Skill Trees - getMonsterSkillDefinition', () => {
  describe('basic lookup', () => {
    it('should find skill in beast archetype', () => {
      const skill = getMonsterSkillDefinition('beast', 'bite');
      assert.ok(skill);
      assert.strictEqual(skill.id, 'bite');
      assert.strictEqual(skill.name, 'Bite');
    });

    it('should find skill in dragon archetype', () => {
      const skill = getMonsterSkillDefinition('dragon', 'fire_breath');
      assert.ok(skill);
      assert.strictEqual(skill.id, 'fire_breath');
      assert.strictEqual(skill.element, 'fire');
    });

    it('should find skill in undead archetype', () => {
      const skill = getMonsterSkillDefinition('undead', 'life_drain');
      assert.ok(skill);
      assert.strictEqual(skill.id, 'life_drain');
      assert.ok(skill.lifesteal > 0);
    });

    it('should find skill in elemental archetype', () => {
      const skill = getMonsterSkillDefinition('elemental', 'flame_burst');
      assert.ok(skill);
      assert.strictEqual(skill.element, 'fire');
    });

    it('should find skill in humanoid archetype', () => {
      const skill = getMonsterSkillDefinition('humanoid', 'slash');
      assert.ok(skill);
      assert.strictEqual(skill.damageType, 'physical');
    });

    it('should find skill in construct archetype', () => {
      const skill = getMonsterSkillDefinition('construct', 'slam');
      assert.ok(skill);
      assert.ok(skill.power > 0);
    });

    it('should find skill in demon archetype', () => {
      const skill = getMonsterSkillDefinition('demon', 'hellfire_bolt');
      assert.ok(skill);
      assert.strictEqual(skill.element, 'dark');
    });

    it('should find skill in insect archetype', () => {
      const skill = getMonsterSkillDefinition('insect', 'sting');
      assert.ok(skill);
      assert.ok(skill.effect === 'poison');
    });

    it('should find skill in plant archetype', () => {
      const skill = getMonsterSkillDefinition('plant', 'vine_lash');
      assert.ok(skill);
      assert.strictEqual(skill.damageType, 'physical');
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase archetype', () => {
      const skill = getMonsterSkillDefinition('BEAST', 'bite');
      assert.ok(skill);
      assert.strictEqual(skill.id, 'bite');
    });

    it('should handle mixed case archetype', () => {
      const skill = getMonsterSkillDefinition('Dragon', 'fire_breath');
      assert.ok(skill);
      assert.strictEqual(skill.id, 'fire_breath');
    });
  });

  describe('not found cases', () => {
    it('should return null for invalid archetype', () => {
      const skill = getMonsterSkillDefinition('invalid_type', 'bite');
      assert.strictEqual(skill, null);
    });

    it('should return null for invalid skill ID', () => {
      const skill = getMonsterSkillDefinition('beast', 'nonexistent_skill');
      assert.strictEqual(skill, null);
    });

    it('should return null for null archetype', () => {
      const skill = getMonsterSkillDefinition(null, 'bite');
      assert.strictEqual(skill, null);
    });

    it('should return null for undefined archetype', () => {
      const skill = getMonsterSkillDefinition(undefined, 'bite');
      assert.strictEqual(skill, null);
    });

    it('should return null for skill from wrong archetype', () => {
      // bite is a beast skill, not dragon
      const skill = getMonsterSkillDefinition('dragon', 'bite');
      assert.strictEqual(skill, null);
    });
  });
});

describe('Monster Skill Trees - getAllMonsterSkills', () => {
  describe('basic retrieval', () => {
    it('should return all beast skills', () => {
      const skills = getAllMonsterSkills('beast');
      assert.ok(Array.isArray(skills));
      assert.ok(skills.length > 0);

      // Should include skills from multiple branches
      const skillIds = skills.map(s => s.id);
      assert.ok(skillIds.includes('bite'));
      assert.ok(skillIds.includes('howl'));
    });

    it('should return all dragon skills', () => {
      const skills = getAllMonsterSkills('dragon');
      const skillIds = skills.map(s => s.id);

      // Should include breath attacks and physical skills
      assert.ok(skillIds.includes('fire_breath'));
      assert.ok(skillIds.includes('tail_swipe'));
    });

    it('should flatten all branches', () => {
      const skills = getAllMonsterSkills('elemental');
      const skillIds = skills.map(s => s.id);

      // Should include skills from Fire, Ice, Lightning, Earth branches
      assert.ok(skillIds.includes('flame_burst'));
      assert.ok(skillIds.includes('frost_bolt'));
      assert.ok(skillIds.includes('shock'));
      assert.ok(skillIds.includes('rock_throw'));
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase', () => {
      const skills = getAllMonsterSkills('UNDEAD');
      assert.ok(skills.length > 0);
    });

    it('should handle mixed case', () => {
      const skills = getAllMonsterSkills('Humanoid');
      assert.ok(skills.length > 0);
    });
  });

  describe('invalid input', () => {
    it('should return empty array for invalid archetype', () => {
      const skills = getAllMonsterSkills('invalid_archetype');
      assert.ok(Array.isArray(skills));
      assert.strictEqual(skills.length, 0);
    });

    it('should return empty array for null', () => {
      const skills = getAllMonsterSkills(null);
      assert.ok(Array.isArray(skills));
      assert.strictEqual(skills.length, 0);
    });

    it('should return empty array for undefined', () => {
      const skills = getAllMonsterSkills(undefined);
      assert.ok(Array.isArray(skills));
      assert.strictEqual(skills.length, 0);
    });
  });

  describe('skill count', () => {
    it('should match manual branch count', () => {
      for (const [archetypeKey, archetype] of Object.entries(MONSTER_SKILL_TREES)) {
        const skills = getAllMonsterSkills(archetypeKey);
        const expectedCount = archetype.branches.reduce(
          (sum, branch) => sum + branch.skills.length, 0
        );
        assert.strictEqual(skills.length, expectedCount,
          `${archetypeKey} skill count mismatch`);
      }
    });
  });
});

describe('Monster Skill Trees - getHighPrioritySkills', () => {
  describe('default threshold (7)', () => {
    it('should return skills with priority >= 7', () => {
      const skills = getHighPrioritySkills('beast');
      for (const skill of skills) {
        assert.ok(skill.priority >= 7,
          `Skill ${skill.id} has priority ${skill.priority}, expected >= 7`);
      }
    });

    it('should return subset of all skills', () => {
      const allSkills = getAllMonsterSkills('beast');
      const highPriority = getHighPrioritySkills('beast');
      assert.ok(highPriority.length <= allSkills.length);
    });

    it('should include high-priority skills', () => {
      const skills = getHighPrioritySkills('dragon');
      const skillIds = skills.map(s => s.id);

      // fire_breath has priority 10
      assert.ok(skillIds.includes('fire_breath'));
    });

    it('should exclude low-priority skills', () => {
      const skills = getHighPrioritySkills('dragon');
      const skillIds = skills.map(s => s.id);

      // dragon_scales has priority 4
      assert.ok(!skillIds.includes('dragon_scales'));
    });
  });

  describe('custom threshold', () => {
    it('should filter by custom minimum priority', () => {
      const skills = getHighPrioritySkills('beast', 9);
      for (const skill of skills) {
        assert.ok(skill.priority >= 9);
      }
    });

    it('should return more skills with lower threshold', () => {
      const highThreshold = getHighPrioritySkills('humanoid', 9);
      const lowThreshold = getHighPrioritySkills('humanoid', 5);
      assert.ok(lowThreshold.length >= highThreshold.length);
    });

    it('should return all skills with threshold 1', () => {
      const allSkills = getAllMonsterSkills('construct');
      const withThreshold1 = getHighPrioritySkills('construct', 1);
      assert.strictEqual(withThreshold1.length, allSkills.length);
    });

    it('should return no skills with threshold 11', () => {
      const skills = getHighPrioritySkills('demon', 11);
      assert.strictEqual(skills.length, 0);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for invalid archetype', () => {
      const skills = getHighPrioritySkills('invalid', 5);
      assert.ok(Array.isArray(skills));
      assert.strictEqual(skills.length, 0);
    });

    it('should handle null archetype', () => {
      const skills = getHighPrioritySkills(null, 5);
      assert.ok(Array.isArray(skills));
      assert.strictEqual(skills.length, 0);
    });
  });

  describe('AI usage scenarios', () => {
    it('should return actionable skills for quick decisions', () => {
      // In AI quick decision mode, we want the most impactful skills
      const quickSkills = getHighPrioritySkills('beast', 8);

      // All returned skills should be usable in combat
      for (const skill of quickSkills) {
        assert.strictEqual(skill.type, 'active');
        assert.ok(typeof skill.range === 'number');
      }
    });

    it('should include damage skills for aggressive AI', () => {
      const skills = getHighPrioritySkills('demon', 8);
      const damageSkills = skills.filter(s => s.power > 0);
      assert.ok(damageSkills.length > 0);
    });
  });
});

describe('Monster Skill Trees - Specific Skill Properties', () => {
  describe('status effect skills', () => {
    it('should have effect duration for effect skills', () => {
      const dragonRoar = getMonsterSkillDefinition('dragon', 'intimidating_roar');
      assert.ok(dragonRoar.effect === 'fear');
      assert.ok(dragonRoar.effectDuration > 0);
      assert.ok(dragonRoar.effectChance > 0);
    });

    it('should have AoE properties for AoE skills', () => {
      const fireNova = getMonsterSkillDefinition('elemental', 'fire_nova');
      assert.ok(fireNova.aoeRadius > 0);
    });
  });

  describe('lifesteal skills', () => {
    it('should have lifesteal property', () => {
      const lifeDrain = getMonsterSkillDefinition('undead', 'life_drain');
      assert.ok(lifeDrain.lifesteal > 0);
      assert.strictEqual(lifeDrain.lifesteal, 0.5);
    });

    it('soul siphon should have full lifesteal', () => {
      const soulSiphon = getMonsterSkillDefinition('undead', 'soul_siphon');
      assert.strictEqual(soulSiphon.lifesteal, 1.0);
      assert.ok(soulSiphon.mpDrain > 0);
    });
  });

  describe('healing skills', () => {
    it('should have healPercent for self-heal', () => {
      const regenerate = getMonsterSkillDefinition('plant', 'regenerate');
      assert.ok(regenerate.healPercent > 0);
    });

    it('should have healPercent for ally heal', () => {
      const healAlly = getMonsterSkillDefinition('humanoid', 'heal_ally');
      assert.ok(healAlly.healPercent > 0);
      assert.ok(healAlly.targetAlly);
    });
  });

  describe('buff skills', () => {
    it('should have selfBuff property', () => {
      const stoneSkin = getMonsterSkillDefinition('elemental', 'stone_skin');
      assert.ok(stoneSkin.selfBuff);
      assert.ok(stoneSkin.buffDuration > 0);
    });

    it('should have targetAllAllies for group buffs', () => {
      const howl = getMonsterSkillDefinition('beast', 'howl');
      assert.ok(howl.targetAllAllies);
    });
  });

  describe('multi-hit skills', () => {
    it('should have hits property', () => {
      const swarmAttack = getMonsterSkillDefinition('insect', 'swarm_attack');
      assert.ok(swarmAttack.hits > 1);
      assert.strictEqual(swarmAttack.hits, 5);
    });

    it('savage assault should have multiple hits', () => {
      const savageAssault = getMonsterSkillDefinition('beast', 'savage_assault');
      assert.strictEqual(savageAssault.hits, 3);
    });
  });

  describe('movement skills', () => {
    it('should have movement property for gap closers', () => {
      const pounce = getMonsterSkillDefinition('beast', 'pounce');
      assert.ok(pounce.movement);
      assert.ok(pounce.range > 1);
    });

    it('charge rush should have movement', () => {
      const chargeRush = getMonsterSkillDefinition('construct', 'charge_rush');
      assert.ok(chargeRush.movement);
    });
  });
});
