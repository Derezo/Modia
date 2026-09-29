import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveAvailableSkillXp, buildStatSummary } from '../characterModalModel.js';

describe('character modal training XP', () => {
  it('preserves an authoritative zero XP pool', () => {
    assert.equal(
      resolveAvailableSkillXp(
        { xpPool: 0 },
        { experience: 20, spent_xp: 100 }
      ),
      0
    );
  });

  it('uses remaining character experience without subtracting spent XP again', () => {
    assert.equal(
      resolveAvailableSkillXp(
        {},
        { experience: 20, spent_xp: 100 }
      ),
      20
    );
  });

  it('normalizes malformed and negative values to zero', () => {
    assert.equal(resolveAvailableSkillXp({ availableXp: 'invalid' }), 0);
    assert.equal(resolveAvailableSkillXp({ availableXp: -5 }), 0);
  });
});

describe('character modal stat strip', () => {
  const base = { hp_max: 120, mp_max: 40, strength: 14, intelligence: 8, agility: 10, vitality: 16, luck: 5 };

  it('adds equipped gear to the totals and includes LCK', () => {
    const stats = {
      hp: { max: 133, bonus: 13 },
      mp: { max: 40, bonus: 0 },
      strength: 29, intelligence: 8, agility: 10, vitality: 18, luck: 5,
      equipmentBonuses: { strength: 15, vitality: 2, hp: 13 }
    };
    const byLabel = Object.fromEntries(buildStatSummary(base, stats).map(s => [s.label, s]));
    assert.deepEqual(byLabel.STR, { label: 'STR', value: 29, bonus: 15 });
    assert.deepEqual(byLabel.VIT, { label: 'VIT', value: 18, bonus: 2 });
    assert.deepEqual(byLabel.HP, { label: 'HP', value: 133, bonus: 13 });
    assert.deepEqual(byLabel.LCK, { label: 'LCK', value: 5, bonus: 0 });
  });

  it('falls back to base stats when computed stats are unavailable', () => {
    const summary = buildStatSummary(base, null);
    assert.deepEqual(summary.map(s => s.label), ['HP', 'MP', 'STR', 'INT', 'AGI', 'VIT', 'LCK']);
    assert.equal(summary.find(s => s.label === 'STR').value, 14);
    assert.ok(summary.every(s => s.bonus === 0));
  });
});
