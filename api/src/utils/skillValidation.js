/**
 * Skill Validation Utilities
 *
 * Provides functions for validating skill prerequisites and determining
 * which skills are eligible for recruit assignment.
 */

import { SKILL_TREES } from '../config/skillTrees.js';

/**
 * Find a skill definition by ID within a class/guild skill tree
 * @param {string} guildClass - The class/guild ID (warrior, monk, etc.)
 * @param {string} skillId - The skill ID to find
 * @returns {Object|null} The skill definition object, or null if not found
 */
export function findSkillDefinition(guildClass, skillId) {
  const tree = SKILL_TREES[guildClass];
  if (!tree) return null;

  for (const branch of tree.branches) {
    const skill = branch.skills.find(s => s.id === skillId);
    if (skill) return skill;
  }
  return null;
}

/**
 * Validate if a character/recruit meets prerequisites for a skill
 * @param {string} guildClass - The class/guild ID
 * @param {string} skillId - The skill to validate
 * @param {Map<string, number>} learnedSkills - Map of skill_id -> level for skills the entity has
 * @returns {{valid: boolean, missing: Array<{skillId: string, required: number, have: number}>}}
 */
export function validateSkillPrerequisites(guildClass, skillId, learnedSkills) {
  const skillDef = findSkillDefinition(guildClass, skillId);

  if (!skillDef) {
    return {
      valid: false,
      missing: [{ skillId, required: 1, have: 0, reason: 'skill_not_found' }]
    };
  }

  // No prerequisites means always valid
  if (!skillDef.requires) {
    return { valid: true, missing: [] };
  }

  const missing = [];
  for (const [reqId, reqLevel] of Object.entries(skillDef.requires)) {
    const haveLevel = learnedSkills.get(reqId) || 0;
    if (haveLevel < reqLevel) {
      missing.push({
        skillId: reqId,
        required: reqLevel,
        have: haveLevel
      });
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Get skills eligible for recruit assignment
 *
 * Recruits get skills at level 1, so only skills with no prerequisites
 * OR prerequisites that can be satisfied at level 1 are eligible.
 *
 * @param {string} guildClass - The class/guild ID
 * @returns {Array<Object>} Array of eligible skill definition objects
 */
export function getRecruitEligibleSkills(guildClass) {
  const classTree = SKILL_TREES[guildClass];
  if (!classTree) return [];

  const skills = [];
  const tier1SkillIds = new Set();

  // First pass: collect tier 1 skills (no requirements)
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && !skill.requires) {
        tier1SkillIds.add(skill.id);
        skills.push(skill);
      }
    }
  }

  // Second pass: tier 2 skills requiring ONLY tier 1 skills AT LEVEL 1
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && skill.requires) {
        const allPrereqsMet = Object.entries(skill.requires).every(
          ([reqId, reqLevel]) => tier1SkillIds.has(reqId) && reqLevel <= 1
        );
        if (allPrereqsMet) {
          skills.push(skill);
        }
      }
    }
  }

  return skills;
}

/**
 * Check if a set of skills can be granted together at level 1
 * (i.e., all prerequisites are satisfied within the set)
 *
 * @param {string} guildClass - The class/guild ID
 * @param {Array<string>} skillIds - Array of skill IDs to validate together
 * @returns {{valid: boolean, invalidSkills: Array<{skillId: string, missing: Array}>}}
 */
export function validateSkillSetForRecruit(guildClass, skillIds) {
  // All skills granted at level 1
  const skillLevels = new Map(skillIds.map(id => [id, 1]));

  const invalidSkills = [];

  for (const skillId of skillIds) {
    const result = validateSkillPrerequisites(guildClass, skillId, skillLevels);
    if (!result.valid) {
      invalidSkills.push({
        skillId,
        missing: result.missing
      });
    }
  }

  return {
    valid: invalidSkills.length === 0,
    invalidSkills
  };
}
