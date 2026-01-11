/**
 * Unit tests for stamina service
 * Tests the calculateCurrentStamina function with various edge cases
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateCurrentStamina } from '../services/staminaService.js';

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

  it('adds regen points for elapsed time (2 minutes = 1 point)', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: twoMinutesAgo
    };
    assert.strictEqual(calculateCurrentStamina(character), 6);
  });

  it('adds multiple regen points for longer elapsed time', () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const character = {
      stamina: 3,
      max_stamina: 8,
      stamina_updated_at: sixMinutesAgo
    };
    // 6 minutes = 3 regen points, 3 + 3 = 6
    assert.strictEqual(calculateCurrentStamina(character), 6);
  });

  it('caps regen at max stamina', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: tenMinutesAgo
    };
    // 10 minutes = 5 regen points, 5 + 5 = 10, but capped at 8
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

  it('does not add partial regen for time less than 2 minutes', () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: oneMinuteAgo
    };
    // 1 minute is not enough for 1 regen point
    assert.strictEqual(calculateCurrentStamina(character), 5);
  });

  it('correctly handles exactly 2 minute boundary', () => {
    const exactlyTwoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const character = {
      stamina: 5,
      max_stamina: 8,
      stamina_updated_at: exactlyTwoMinutesAgo
    };
    // Exactly 2 minutes = 1 regen point
    assert.strictEqual(calculateCurrentStamina(character), 6);
  });
});
