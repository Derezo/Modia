import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MONSTER_SKILL_TREES } from '../../../../api/src/config/monsterSkillTrees.js';
import { SKILL_TREES } from '../../../../api/src/config/skillTrees.js';
import {
  GENERIC_SKILL_SFX,
  MONSTER_SKILL_SFX_ALIASES,
  STATUS_SFX_ALIASES,
  getSkillSfxCandidates,
  getStatusSfxCandidates,
  resolveRegisteredSfx,
  resolveSkillSfx,
  resolveStatusSfx
} from '../audioEffectResolver.js';
import { SFX_MANIFEST } from '../manifests/sfxManifest.js';

function getActiveSkills(skillTrees) {
  return Object.values(skillTrees)
    .flatMap(tree => tree.branches)
    .flatMap(branch => branch.skills)
    .filter(skill => skill.type === 'active');
}

function assertSpecificRegisteredSfx(soundKey, context) {
  assert.notEqual(soundKey, GENERIC_SKILL_SFX, `${context} used generic SFX`);
  assert.ok(SFX_MANIFEST[soundKey], `${context} resolved to missing ${soundKey}`);
}

describe('audio effect resolution', () => {
  it('resolves every active player skill to a specific registered SFX', () => {
    for (const skill of getActiveSkills(SKILL_TREES)) {
      assertSpecificRegisteredSfx(
        resolveSkillSfx(skill.id),
        `player skill ${skill.id}`
      );
    }
  });

  it('resolves every active monster skill to a specific registered SFX', () => {
    for (const skill of getActiveSkills(MONSTER_SKILL_TREES)) {
      assertSpecificRegisteredSfx(
        resolveSkillSfx(skill.id, true),
        `monster skill ${skill.id}`
      );
    }
  });

  it('provides semantic candidates for all aliased monster skills', () => {
    for (const [skillId, aliasKey] of Object.entries(MONSTER_SKILL_SFX_ALIASES)) {
      assert.deepEqual(
        getSkillSfxCandidates(skillId, true),
        [`monster_${skillId}`, aliasKey]
      );
      assert.ok(SFX_MANIFEST[aliasKey], `${skillId} alias ${aliasKey} is missing`);
    }
  });

  it('resolves every active effect and self-buff to a specific registered SFX', () => {
    const activeSkills = [
      ...getActiveSkills(SKILL_TREES),
      ...getActiveSkills(MONSTER_SKILL_TREES)
    ];
    const effectTypes = new Set(
      activeSkills
        .flatMap(skill => [skill.effect, skill.selfBuff])
        .filter(effectType => typeof effectType === 'string')
    );

    for (const effectType of effectTypes) {
      assertSpecificRegisteredSfx(
        resolveStatusSfx(effectType),
        `status ${effectType}`
      );
    }
  });

  it('provides semantic candidates for every aliased status', () => {
    for (const [effectType, aliasKey] of Object.entries(STATUS_SFX_ALIASES)) {
      assert.deepEqual(
        getStatusSfxCandidates(effectType),
        [`status_${effectType}`, aliasKey]
      );
      assert.ok(
        SFX_MANIFEST[aliasKey],
        `${effectType} alias ${aliasKey} is missing`
      );
    }
  });

  it('uses the generic cast SFX only for unknown future values', () => {
    assert.ok(SFX_MANIFEST[GENERIC_SKILL_SFX]);
    assert.equal(resolveSkillSfx('future_player_skill'), GENERIC_SKILL_SFX);
    assert.equal(
      resolveSkillSfx('future_monster_skill', true),
      GENERIC_SKILL_SFX
    );
    assert.equal(resolveStatusSfx('future_status'), GENERIC_SKILL_SFX);
  });

  it('selects the first registered candidate and honors an explicit fallback', () => {
    assert.equal(
      resolveRegisteredSfx(['missing_effect', 'impact_hit', 'status_rage']),
      'impact_hit'
    );
    assert.equal(resolveRegisteredSfx(['missing_effect']), GENERIC_SKILL_SFX);
    assert.equal(
      resolveRegisteredSfx(['missing_effect'], 'impact_miss'),
      'impact_miss'
    );
  });
});
