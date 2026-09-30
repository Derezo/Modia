import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCompletionBonus } from '../completionBonus.js';

describe('formatCompletionBonus', () => {
  it('formats a granted bonus', () => {
    assert.equal(formatCompletionBonus({ gold: 30, xp: 45 }), '+30g, +45 XP');
  });

  it('returns null when no bonus was granted', () => {
    assert.equal(formatCompletionBonus(null), null);
    assert.equal(formatCompletionBonus(undefined), null);
  });
});
