import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SKILL_TREES,
  getGuildProgressionPath,
  buildTrainingSkillTree,
  findSkillInTrainingTree
} from '../../config/skillTrees.js';

describe('Training Grounds skill trees', () => {
  it('keeps direct base guild tree behavior compatible', () => {
    assert.deepEqual(getGuildProgressionPath('wizard'), ['wizard']);
    assert.equal(buildTrainingSkillTree('wizard'), SKILL_TREES.wizard);
  });

  it('combines wizard and sorcerer authored trees for a sorcerer', () => {
    const tree = buildTrainingSkillTree('sorcerer');

    assert.deepEqual(tree.progressionPath, ['wizard', 'sorcerer']);
    assert.deepEqual(tree.authoredSources, ['wizard', 'sorcerer']);
    assert.deepEqual(tree.inheritedSources, ['wizard']);
    assert.equal(tree.trainingClass, 'sorcerer');
    assert.equal(tree.advancedFrom, 'wizard');
    assert.equal(tree.currentClassHasAuthoredTree, true);
    assert.ok(tree.sourceTrees.every(source => source.authored));
    assert.ok(tree.branches
      .filter(branch => branch.sourceGuildId === 'wizard')
      .every(branch => branch.sourceGuildName === 'Wizard Guild' && branch.inherited));
    assert.ok(tree.branches
      .filter(branch => branch.sourceGuildId === 'sorcerer')
      .every(branch => branch.sourceGuildName === 'Sorcerer Guild' && !branch.inherited));
    assert.ok(tree.branches.some(branch => branch.skills.some(skill => skill.id === 'fireball')));
    assert.ok(tree.branches.some(branch => branch.skills.some(skill => skill.id === 'arcane_bolt')));
    assert.equal(new Set(tree.branches.map(branch => branch.name)).size, tree.branches.length);
  });

  it('falls back to authored wizard and sorcerer trees for a summoner', () => {
    const tree = buildTrainingSkillTree('summoner');

    assert.deepEqual(tree.progressionPath, ['wizard', 'sorcerer', 'summoner']);
    assert.deepEqual(tree.authoredSources, ['wizard', 'sorcerer']);
    assert.deepEqual(tree.inheritedSources, ['wizard', 'sorcerer']);
    assert.deepEqual(tree.unavailableSources, ['summoner']);
    assert.equal(tree.trainingClass, 'summoner');
    assert.equal(tree.currentClassHasAuthoredTree, false);
    assert.ok(tree.sourceTrees.every(source => source.authored && source.inherited));
    assert.ok(tree.branches.some(branch => branch.skills.some(skill => skill.id === 'fireball')));
    assert.ok(tree.branches.some(branch => branch.skills.some(skill => skill.id === 'arcane_bolt')));
    assert.ok(!tree.authoredSources.includes('conjurer'));
  });

  it('returns null for an unknown class', () => {
    assert.equal(getGuildProgressionPath('chronomancer'), null);
    assert.equal(buildTrainingSkillTree('chronomancer'), null);
  });

  it('finds an inherited base skill after advancement', () => {
    const skill = findSkillInTrainingTree('summoner', 'fireball');

    assert.equal(skill?.id, 'fireball');
    assert.equal(skill, SKILL_TREES.wizard.branches[0].skills[0]);
  });
});
