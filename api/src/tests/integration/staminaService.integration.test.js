/**
 * Unit tests for stamina service
 * Tests the calculateCurrentStamina function with various edge cases
 *
 * Note: REGEN_INTERVAL_MS varies by environment:
 * - Development: 5 seconds
 * - Production: 2 minutes
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateCurrentStamina, REGEN_INTERVAL_MS } from '../../services/staminaService.js';

// Helper to create elapsed time for N regen points
const regenTime = (points) => points * REGEN_INTERVAL_MS;

describe('calculateCurrentStamina', () => {
  it('returns stored stamina when at max', () => {
    const character = {
      stamina: 8,
      max_stamina: 8,
      stamina_updated_at: new Date()
    };
    assert.strictEqual(calculateCurrentStamina(character), 8);
  });

  it('returns max stamina when stored exceeds max', () => {
    const character = {
      stamina: 10,
      max_stamina: 8,
      stamina_updated_at: new Date()
    };
    assert.strictEqual(calculateCurrentStamina(character), 8);
  });

  it('adds regen points for elapsed time (1 interval = 1 point)', () => {
    const oneIntervalAgo = new Date(Date.now() - regenTime(1));
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: oneIntervalAgo
    };
    assert.strictEqual(calculateCurrentStamina(character), 6);
  });

  it('adds multiple regen points for longer elapsed time', () => {
    const threeIntervalsAgo = new Date(Date.now() - regenTime(3));
    const character = {
      stamina: 3,
      max_stamina: 8,
      stamina_updated_at: threeIntervalsAgo
    };
    // 3 intervals = 3 regen points, 3 + 3 = 6
    assert.strictEqual(calculateCurrentStamina(character), 6);
  });

  it('caps regen at max stamina', () => {
    const fiveIntervalsAgo = new Date(Date.now() - regenTime(5));
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: fiveIntervalsAgo
    };
    // 5 intervals = 5 regen points, 5 + 5 = 10, but capped at 8
    assert.strictEqual(calculateCurrentStamina(character), 8);
  });

  it('handles future timestamps gracefully (no negative regen)', () => {
    // This tests the safeguard for timezone bugs
    const futureTime = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours future
    const character = {
      stamina: 7,
      max_stamina: 8,
      stamina_updated_at: futureTime
    };
    // Should NOT return negative - safeguard should prevent negative regen
    const result = calculateCurrentStamina(character);
    assert.ok(result >= 0, `Expected non-negative, got ${result}`);
    // With safeguard, future timestamps should return stored stamina (no regen)
    assert.strictEqual(result, 7);
  });

  it('clamps negative stored stamina to 0', () => {
    const character = {
      stamina: -5,
      max_stamina: 8,
      stamina_updated_at: new Date()
    };
    const result = calculateCurrentStamina(character);
    assert.ok(result >= 0, `Expected non-negative, got ${result}`);
  });

  it('handles missing stamina_updated_at by using current time', () => {
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: null
    };
    // With no timestamp, should treat as just updated (no regen)
    assert.strictEqual(calculateCurrentStamina(character), 5);
  });

  it('handles undefined max_stamina with default of 8', () => {
    const character = {
      stamina: 5,
      stamina_updated_at: new Date()
    };
    // Should use default max of 8
    const result = calculateCurrentStamina(character);
    assert.strictEqual(result, 5);
  });

  it('handles undefined stamina with default of 8 (max)', () => {
    const character = {
      max_stamina: 8,
      stamina_updated_at: new Date()
    };
    // Should use default stamina of 8 (DEFAULT_MAX_STAMINA)
    const result = calculateCurrentStamina(character);
    assert.strictEqual(result, 8);
  });

  it('does not add partial regen for time less than 1 interval', () => {
    const halfIntervalAgo = new Date(Date.now() - regenTime(0.5));
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: halfIntervalAgo
    };
    // Half an interval is not enough for 1 regen point
    assert.strictEqual(calculateCurrentStamina(character), 5);
  });

  it('correctly handles exactly 1 interval boundary', () => {
    const exactlyOneIntervalAgo = new Date(Date.now() - regenTime(1));
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: exactlyOneIntervalAgo
    };
    // Exactly 1 interval = 1 regen point
    assert.strictEqual(calculateCurrentStamina(character), 6);
  });
});
