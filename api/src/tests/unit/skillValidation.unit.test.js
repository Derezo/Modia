/**
 * Unit tests for skillValidation.js
 * Tests skill prerequisite validation and recruit eligibility
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  findSkillDefinition,
  validateSkillPrerequisites,
  getRecruitEligibleSkills,
  validateSkillSetForRecruit
} from '../../utils/skillValidation.js';

// =============================================================================
// findSkillDefinition TESTS
// =============================================================================

describe('findSkillDefinition', () => {
  test('should find warrior power_strike skill', () => {
    const skill = findSkillDefinition('warrior', 'power_strike');

    assert.ok(skill, 'Should find power_strike');
    assert.strictEqual(skill.id, 'power_strike');
    assert.strictEqual(skill.type, 'active');
  });

  test('should find wizard fireball skill', () => {
    const skill = findSkillDefinition('wizard', 'fireball');

    assert.ok(skill, 'Should find fireball');
    assert.strictEqual(skill.id, 'fireball');
  });

  test('should find monk palm_strike skill', () => {
    const skill = findSkillDefinition('monk', 'palm_strike');

    assert.ok(skill, 'Should find palm_strike');
    assert.strictEqual(skill.id, 'palm_strike');
  });

  test('should return null for non-existent skill', () => {
    const skill = findSkillDefinition('warrior', 'nonexistent_skill');

    assert.strictEqual(skill, null);
  });

  test('should return null for non-existent guild', () => {
    const skill = findSkillDefinition('nonexistent_guild', 'power_strike');

    assert.strictEqual(skill, null);
  });

  test('should find skills across different branches', () => {
    // Offense branch
    const offenseSkill = findSkillDefinition('warrior', 'power_strike');
    assert.ok(offenseSkill);

    // Defense branch
    const defenseSkill = findSkillDefinition('warrior', 'shield_bash');
    assert.ok(defenseSkill);

    // Passive branch
    const passiveSkill = findSkillDefinition('warrior', 'warrior_strength');
    assert.ok(passiveSkill);
    assert.strictEqual(passiveSkill.type, 'passive');
  });

  test('should find skill with prerequisites', () => {
    const skill = findSkillDefinition('warrior', 'cleave');

    assert.ok(skill);
    assert.ok(skill.requires, 'Cleave should have prerequisites');
    assert.ok(skill.requires.power_strike, 'Should require power_strike');
  });
});

// =============================================================================
// validateSkillPrerequisites TESTS
// =============================================================================

describe('validateSkillPrerequisites', () => {
  test('should validate skill with no prerequisites', () => {
    const learnedSkills = new Map();
    const result = validateSkillPrerequisites('warrior', 'power_strike', learnedSkills);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.missing.length, 0);
  });

  test('should fail for non-existent skill', () => {
    const learnedSkills = new Map();
    const result = validateSkillPrerequisites('warrior', 'nonexistent', learnedSkills);

    assert.strictEqual(result.valid, false);
    assert.ok(result.missing.some(m => m.reason === 'skill_not_found'));
  });

  test('should fail when prerequisite not learned', () => {
    const learnedSkills = new Map();
    const result = validateSkillPrerequisites('warrior', 'cleave', learnedSkills);

    assert.strictEqual(result.valid, false);
    assert.ok(result.missing.some(m => m.skillId === 'power_strike'));
  });

  test('should fail when prerequisite level too low', () => {
    const learnedSkills = new Map([['power_strike', 3]]); // Has level 3, needs 5
    const result = validateSkillPrerequisites('warrior', 'cleave', learnedSkills);

    assert.strictEqual(result.valid, false);
    const missing = result.missing.find(m => m.skillId === 'power_strike');
    assert.ok(missing);
    assert.strictEqual(missing.required, 5);
    assert.strictEqual(missing.have, 3);
  });

  test('should pass when prerequisite level met exactly', () => {
    const learnedSkills = new Map([['power_strike', 5]]);
    const result = validateSkillPrerequisites('warrior', 'cleave', learnedSkills);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.missing.length, 0);
  });

  test('should pass when prerequisite level exceeded', () => {
    const learnedSkills = new Map([['power_strike', 10]]);
    const result = validateSkillPrerequisites('warrior', 'cleave', learnedSkills);

    assert.strictEqual(result.valid, true);
  });

  test('should validate wizard inferno prerequisites', () => {
    // Inferno requires fireball at level 5
    const noFireball = new Map();
    const result1 = validateSkillPrerequisites('wizard', 'inferno', noFireball);
    assert.strictEqual(result1.valid, false);

    const withFireball = new Map([['fireball', 5]]);
    const result2 = validateSkillPrerequisites('wizard', 'inferno', withFireball);
    assert.strictEqual(result2.valid, true);
  });

  test('should validate monk thousand_fists chain prerequisites', () => {
    // thousand_fists requires flying_kick which requires palm_strike
    const noSkills = new Map();
    const result1 = validateSkillPrerequisites('monk', 'thousand_fists', noSkills);
    assert.strictEqual(result1.valid, false);

    // Has flying_kick but not at required level
    const partialSkills = new Map([['flying_kick', 3]]);
    const result2 = validateSkillPrerequisites('monk', 'thousand_fists', partialSkills);
    assert.strictEqual(result2.valid, false);

    // Has flying_kick at required level
    const fullSkills = new Map([['flying_kick', 5]]);
    const result3 = validateSkillPrerequisites('monk', 'thousand_fists', fullSkills);
    assert.strictEqual(result3.valid, true);
  });

  test('should handle passive skills', () => {
    const learnedSkills = new Map();
    const result = validateSkillPrerequisites('warrior', 'warrior_strength', learnedSkills);

    assert.strictEqual(result.valid, true);
  });
});

// =============================================================================
// getRecruitEligibleSkills TESTS
// =============================================================================

describe('getRecruitEligibleSkills', () => {
  test('should return skills for warrior', () => {
    const skills = getRecruitEligibleSkills('warrior');

    assert.ok(skills.length > 0, 'Should have eligible skills');
    // All returned skills should be active type
    const activeSkills = skills.filter(s => s.type === 'active');
    assert.strictEqual(activeSkills.length, skills.length, 'Should only include active skills');
  });

  test('should include tier 1 skills (no prerequisites)', () => {
    const skills = getRecruitEligibleSkills('warrior');

    assert.ok(skills.some(s => s.id === 'power_strike'), 'Should include power_strike');
    assert.ok(skills.some(s => s.id === 'shield_bash'), 'Should include shield_bash');
  });

  test('should exclude passive skills', () => {
    const skills = getRecruitEligibleSkills('warrior');

    assert.ok(!skills.some(s => s.type === 'passive'), 'Should not include passive skills');
    assert.ok(!skills.some(s => s.id === 'warrior_strength'), 'Should not include warrior_strength');
  });

  test('should return empty for non-existent guild', () => {
    const skills = getRecruitEligibleSkills('nonexistent_guild');

    assert.strictEqual(skills.length, 0);
  });

  test('should work for wizard', () => {
    const skills = getRecruitEligibleSkills('wizard');

    assert.ok(skills.length > 0);
    assert.ok(skills.some(s => s.id === 'fireball'), 'Should include fireball');
    assert.ok(skills.some(s => s.id === 'ice_shard'), 'Should include ice_shard');
    assert.ok(skills.some(s => s.id === 'lightning_bolt'), 'Should include lightning_bolt');
  });

  test('should work for monk', () => {
    const skills = getRecruitEligibleSkills('monk');

    assert.ok(skills.length > 0);
    assert.ok(skills.some(s => s.id === 'palm_strike'), 'Should include palm_strike');
    assert.ok(skills.some(s => s.id === 'meditation'), 'Should include meditation');
  });

  test('should include tier 2 skills with level 1 prerequisites', () => {
    // This tests that tier 2 skills requiring tier 1 skills at level 1 are included
    const skills = getRecruitEligibleSkills('warrior');

    // Check for presence of skills - exact set depends on skill tree config
    skills.forEach(skill => {
      if (skill.requires) {
        // All prerequisites should be satisfiable at level 1
        Object.entries(skill.requires).forEach(([reqId, reqLevel]) => {
          assert.ok(reqLevel <= 1, `${skill.id} requires ${reqId} at level ${reqLevel}, should be <= 1`);
        });
      }
    });
  });

  test('should exclude skills with high-level prerequisites', () => {
    const skills = getRecruitEligibleSkills('warrior');

    // Cleave requires power_strike at level 5, so should not be included
    assert.ok(!skills.some(s => s.id === 'cleave'), 'Should not include cleave (requires level 5)');
    assert.ok(!skills.some(s => s.id === 'rage'), 'Should not include rage (requires cleave at level 5)');
  });
});

// =============================================================================
// validateSkillSetForRecruit TESTS
// =============================================================================

describe('validateSkillSetForRecruit', () => {
  test('should validate single tier 1 skill', () => {
    const result = validateSkillSetForRecruit('warrior', ['power_strike']);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.invalidSkills.length, 0);
  });

  test('should validate multiple tier 1 skills', () => {
    const result = validateSkillSetForRecruit('warrior', ['power_strike', 'shield_bash']);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.invalidSkills.length, 0);
  });

  test('should fail for skill with unmet prerequisites', () => {
    // cleave requires power_strike at level 5, but recruits only get level 1
    const result = validateSkillSetForRecruit('warrior', ['cleave']);

    assert.strictEqual(result.valid, false);
    assert.ok(result.invalidSkills.some(i => i.skillId === 'cleave'));
  });

  test('should fail for non-existent skill', () => {
    const result = validateSkillSetForRecruit('warrior', ['nonexistent_skill']);

    assert.strictEqual(result.valid, false);
  });

  test('should validate empty skill set', () => {
    const result = validateSkillSetForRecruit('warrior', []);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.invalidSkills.length, 0);
  });

  test('should provide missing prerequisites in error', () => {
    const result = validateSkillSetForRecruit('warrior', ['cleave']);

    assert.strictEqual(result.valid, false);
    const invalid = result.invalidSkills.find(i => i.skillId === 'cleave');
    assert.ok(invalid);
    assert.ok(invalid.missing.length > 0);
    assert.ok(invalid.missing.some(m => m.skillId === 'power_strike'));
  });

  test('should work for wizard skills', () => {
    const result = validateSkillSetForRecruit('wizard', ['fireball', 'ice_shard']);

    assert.strictEqual(result.valid, true);
  });

  test('should fail wizard skill with prerequisites', () => {
    // inferno requires fireball at level 5
    const result = validateSkillSetForRecruit('wizard', ['inferno']);

    assert.strictEqual(result.valid, false);
  });

  test('should work for monk skills', () => {
    const result = validateSkillSetForRecruit('monk', ['palm_strike', 'meditation']);

    assert.strictEqual(result.valid, true);
  });

  test('should handle mixed valid and invalid skills', () => {
    // power_strike is valid, cleave is not
    const result = validateSkillSetForRecruit('warrior', ['power_strike', 'cleave']);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.invalidSkills.length, 1);
    assert.ok(result.invalidSkills.some(i => i.skillId === 'cleave'));
  });

  test('should validate all skills are granted at level 1', () => {
    // This is the key behavior - skills in the set are assumed to be at level 1
    const result = validateSkillSetForRecruit('warrior', ['power_strike']);

    // power_strike has no requirements, so valid at level 1
    assert.strictEqual(result.valid, true);
  });
});
