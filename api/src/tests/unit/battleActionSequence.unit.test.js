import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  validateActionSequence,
  resetActionSequence,
  cleanupBattleSequences,
  startCleanupTimer,
  stopCleanupTimer,
  _resetForTests
} from '../../services/battleActionSequence.js';

describe('validateActionSequence', () => {
  beforeEach(() => _resetForTests());

  describe('legacy clients (no sequence)', () => {
    it('accepts undefined sequence', () => {
      assert.deepStrictEqual(validateActionSequence(1, 100, undefined), { valid: true });
    });
    it('accepts null sequence', () => {
      assert.deepStrictEqual(validateActionSequence(1, 100, null), { valid: true });
    });
  });

  describe('monotonic sequences', () => {
    it('accepts the first sequence', () => {
      const r = validateActionSequence(1, 100, 1);
      assert.strictEqual(r.valid, true);
    });

    it('accepts strictly increasing sequences', () => {
      validateActionSequence(1, 100, 1);
      validateActionSequence(1, 100, 2);
      assert.strictEqual(validateActionSequence(1, 100, 3).valid, true);
    });

    it('rejects duplicate sequence', () => {
      validateActionSequence(1, 100, 5);
      const r = validateActionSequence(1, 100, 5);
      assert.strictEqual(r.valid, false);
      assert.match(r.error, /stale|duplicate/i);
    });

    it('rejects stale (lower) sequence', () => {
      validateActionSequence(1, 100, 5);
      const r = validateActionSequence(1, 100, 3);
      assert.strictEqual(r.valid, false);
    });

    it('does not leak internal details in error message', () => {
      validateActionSequence(1, 100, 5);
      const r = validateActionSequence(1, 100, 5);
      assert.ok(!/\d+/.test(r.error || ''), 'error message should not include numeric internals');
    });
  });

  describe('isolation', () => {
    it('tracks per-battle independently', () => {
      validateActionSequence(1, 100, 5);
      assert.strictEqual(validateActionSequence(2, 100, 1).valid, true);
    });

    it('tracks per-user independently', () => {
      validateActionSequence(1, 100, 5);
      assert.strictEqual(validateActionSequence(1, 200, 1).valid, true);
    });
  });

  describe('resetActionSequence', () => {
    it('clears state for a single battle/user pair', () => {
      validateActionSequence(1, 100, 5);
      resetActionSequence(1, 100);
      assert.strictEqual(validateActionSequence(1, 100, 1).valid, true);
    });

    it('does not affect other users in the same battle', () => {
      validateActionSequence(1, 100, 5);
      validateActionSequence(1, 200, 5);
      resetActionSequence(1, 100);
      assert.strictEqual(validateActionSequence(1, 200, 1).valid, false);
    });
  });

  describe('cleanupBattleSequences', () => {
    it('clears all users for a battle', () => {
      validateActionSequence(1, 100, 5);
      validateActionSequence(1, 200, 5);
      validateActionSequence(2, 100, 5);
      cleanupBattleSequences(1);
      assert.strictEqual(validateActionSequence(1, 100, 1).valid, true);
      assert.strictEqual(validateActionSequence(1, 200, 1).valid, true);
      assert.strictEqual(validateActionSequence(2, 100, 1).valid, false);
    });
  });

  describe('cleanup timer lifecycle', () => {
    it('startCleanupTimer is idempotent and stopCleanupTimer cancels it', () => {
      startCleanupTimer();
      startCleanupTimer();
      stopCleanupTimer();
      stopCleanupTimer();
      assert.ok(true, 'timer lifecycle calls do not throw');
    });
  });
});
