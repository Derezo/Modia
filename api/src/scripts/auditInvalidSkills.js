#!/usr/bin/env node
/**
 * Audit and Fix Invalid Skill Assignments
 *
 * This script checks for skill prerequisite violations in:
 * - recruit_skills: Skills assigned to guild recruits
 * - character_skills: Skills learned by player characters
 *
 * Usage:
 *   node api/src/scripts/auditInvalidSkills.js           # Audit only (read-only)
 *   node api/src/scripts/auditInvalidSkills.js --fix     # Audit and remove invalid entries
 *
 * The script will:
 * 1. Check all recruit_skills entries against skill tree prerequisites
 * 2. Check all character_skills entries (grouped by character)
 * 3. Report any violations found
 * 4. If --fix is passed, remove the invalid entries
 */

import { query, pool } from '../config/database.js';
import { SKILL_TREES } from '../config/skillTrees.js';
import {
  findSkillDefinition,
  validateSkillPrerequisites
} from '../utils/skillValidation.js';

const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

/**
 * Audit recruit_skills table for prerequisite violations
 */
async function auditRecruitSkills(shouldFix = false) {
  console.log('\n=== Auditing recruit_skills table ===\n');

  // Get all recruit skills with their class
  const result = await query(`
    SELECT rs.id, rs.recruit_id, rs.skill_id, gr.class, gr.name as recruit_name
    FROM recruit_skills rs
    JOIN guild_recruits gr ON rs.recruit_id = gr.id
    WHERE gr.purchased_by IS NULL
    ORDER BY gr.class, rs.recruit_id
  `);

  if (result.rows.length === 0) {
    console.log('No active recruit skills found.\n');
    return [];
  }

  console.log(`Found ${result.rows.length} recruit skill assignments to check.\n`);

  // Group by recruit for batch checking
  const recruitSkillsMap = new Map();
  for (const row of result.rows) {
    if (!recruitSkillsMap.has(row.recruit_id)) {
      recruitSkillsMap.set(row.recruit_id, {
        class: row.class,
        name: row.recruit_name,
        skills: []
      });
    }
    recruitSkillsMap.get(row.recruit_id).skills.push({
      id: row.id,
      skill_id: row.skill_id
    });
  }

  const invalidEntries = [];

  for (const [recruitId, data] of recruitSkillsMap) {
    // All skills granted at level 1
    const skillLevels = new Map(data.skills.map(s => [s.skill_id, 1]));

    for (const skill of data.skills) {
      const validation = validateSkillPrerequisites(
        data.class,
        skill.skill_id,
        skillLevels
      );

      if (!validation.valid) {
        invalidEntries.push({
          table: 'recruit_skills',
          id: skill.id,
          recruit_id: recruitId,
          recruit_name: data.name,
          skill_id: skill.skill_id,
          class: data.class,
          missing: validation.missing
        });
      }
    }
  }

  if (invalidEntries.length === 0) {
    console.log('No invalid recruit skill assignments found.\n');
  } else {
    console.log(`Found ${invalidEntries.length} INVALID recruit skill assignments:\n`);

    for (const entry of invalidEntries) {
      console.log(`  - Recruit "${entry.recruit_name}" (${entry.class}, ID: ${entry.recruit_id})`);
      console.log(`    Skill: ${entry.skill_id}`);
      for (const m of entry.missing) {
        console.log(`    Missing: ${m.skillId} level ${m.required} (have ${m.have})`);
      }
      console.log();
    }

    if (shouldFix) {
      console.log('Removing invalid entries...');
      const ids = invalidEntries.map(e => e.id);
      await query('DELETE FROM recruit_skills WHERE id = ANY($1)', [ids]);
      console.log(`Removed ${ids.length} invalid recruit_skills entries.\n`);
    }
  }

  return invalidEntries;
}

/**
 * Audit character_skills table for prerequisite violations
 */
async function auditCharacterSkills(shouldFix = false) {
  console.log('\n=== Auditing character_skills table ===\n');

  // Get all character skills with their class
  const result = await query(`
    SELECT cs.id, cs.character_id, cs.skill_id, cs.level, c.class, c.name as char_name
    FROM character_skills cs
    JOIN characters c ON cs.character_id = c.id
    ORDER BY c.class, cs.character_id
  `);

  if (result.rows.length === 0) {
    console.log('No character skills found.\n');
    return [];
  }

  console.log(`Found ${result.rows.length} character skill assignments to check.\n`);

  // Group by character for batch checking
  const characterSkillsMap = new Map();
  for (const row of result.rows) {
    if (!characterSkillsMap.has(row.character_id)) {
      characterSkillsMap.set(row.character_id, {
        class: row.class,
        name: row.char_name,
        skills: new Map()
      });
    }
    characterSkillsMap.get(row.character_id).skills.set(row.skill_id, {
      id: row.id,
      level: row.level
    });
  }

  const invalidEntries = [];

  for (const [charId, data] of characterSkillsMap) {
    // Build skill levels map
    const skillLevels = new Map();
    for (const [skillId, info] of data.skills) {
      skillLevels.set(skillId, info.level);
    }

    for (const [skillId, info] of data.skills) {
      const validation = validateSkillPrerequisites(
        data.class,
        skillId,
        skillLevels
      );

      if (!validation.valid) {
        invalidEntries.push({
          table: 'character_skills',
          id: info.id,
          character_id: charId,
          char_name: data.name,
          skill_id: skillId,
          skill_level: info.level,
          class: data.class,
          missing: validation.missing
        });
      }
    }
  }

  if (invalidEntries.length === 0) {
    console.log('No invalid character skill assignments found.\n');
  } else {
    console.log(`Found ${invalidEntries.length} INVALID character skill assignments:\n`);

    for (const entry of invalidEntries) {
      console.log(`  - Character "${entry.char_name}" (${entry.class}, ID: ${entry.character_id})`);
      console.log(`    Skill: ${entry.skill_id} (level ${entry.skill_level})`);
      for (const m of entry.missing) {
        console.log(`    Missing: ${m.skillId} level ${m.required} (have ${m.have})`);
      }
      console.log();
    }

    if (shouldFix) {
      console.log('Removing invalid entries...');
      const ids = invalidEntries.map(e => e.id);
      await query('DELETE FROM character_skills WHERE id = ANY($1)', [ids]);
      console.log(`Removed ${ids.length} invalid character_skills entries.\n`);
    }
  }

  return invalidEntries;
}

/**
 * Main entry point
 */
async function main() {
  const shouldFix = process.argv.includes('--fix');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Skill Prerequisite Audit Tool                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Mode: ${shouldFix ? 'FIX (will remove invalid entries)' : 'AUDIT ONLY (read-only)'}`);

  try {
    const recruitIssues = await auditRecruitSkills(shouldFix);
    const characterIssues = await auditCharacterSkills(shouldFix);

    const totalIssues = recruitIssues.length + characterIssues.length;

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  recruit_skills issues:   ${recruitIssues.length}`);
    console.log(`  character_skills issues: ${characterIssues.length}`);
    console.log(`  Total issues:            ${totalIssues}`);
    console.log();

    if (totalIssues > 0 && !shouldFix) {
      console.log('To fix these issues, run:');
      console.log('  node api/src/scripts/auditInvalidSkills.js --fix');
      console.log();
    }

    if (totalIssues === 0) {
      console.log('All skill assignments are valid!');
    }

  } catch (error) {
    console.error('Error during audit:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
