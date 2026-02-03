/**
 * Unit tests for WebSocket rate limiter infrastructure message exemptions.
 *
 * Tests that infrastructure messages (heartbeat, ack, etc.) bypass rate limiting
 * while regular messages (chat, reactions) are still subject to limits.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isInfrastructureMessage,
  INFRASTRUCTURE_MESSAGES,
  MESSAGE_CATEGORIES
} from '../../websocket/rateLimiter.js';

describe('WebSocket Rate Limiter', () => {
  describe('isInfrastructureMessage', () => {
    it('should return true for heartbeat messages', () => {
      assert.strictEqual(isInfrastructureMessage('heartbeat'), true);
    });

    it('should return true for ack messages', () => {
      assert.strictEqual(isInfrastructureMessage('ack'), true);
    });

    it('should return true for battle:request_sync messages', () => {
      assert.strictEqual(isInfrastructureMessage('battle:request_sync'), true);
    });

    it('should return true for pong messages', () => {
      assert.strictEqual(isInfrastructureMessage('pong'), true);
    });

    it('should return false for chat_message', () => {
      assert.strictEqual(isInfrastructureMessage('chat_message'), false);
    });

    it('should return false for private_message', () => {
      assert.strictEqual(isInfrastructureMessage('private_message'), false);
    });

    it('should return false for join_room', () => {
      assert.strictEqual(isInfrastructureMessage('join_room'), false);
    });

    it('should return false for typing_indicator', () => {
      assert.strictEqual(isInfrastructureMessage('typing_indicator'), false);
    });

    it('should return false for add_reaction', () => {
      assert.strictEqual(isInfrastructureMessage('add_reaction'), false);
    });

    it('should return false for unknown message types', () => {
      assert.strictEqual(isInfrastructureMessage('unknown_type'), false);
      assert.strictEqual(isInfrastructureMessage(''), false);
      assert.strictEqual(isInfrastructureMessage(null), false);
      assert.strictEqual(isInfrastructureMessage(undefined), false);
    });
  });

  describe('INFRASTRUCTURE_MESSAGES', () => {
    it('should contain exactly 4 message types', () => {
      assert.strictEqual(INFRASTRUCTURE_MESSAGES.size, 4);
    });

    it('should be a Set for O(1) lookup', () => {
      assert.ok(INFRASTRUCTURE_MESSAGES instanceof Set);
    });

    it('should not overlap with MESSAGE_CATEGORIES', () => {
      // Infrastructure messages should not be in the rate-limited categories
      for (const infraMsg of INFRASTRUCTURE_MESSAGES) {
        assert.strictEqual(
          MESSAGE_CATEGORIES[infraMsg],
          undefined,
          `Infrastructure message "${infraMsg}" should not be in MESSAGE_CATEGORIES`
        );
      }
    });
  });

  describe('MESSAGE_CATEGORIES', () => {
    it('should categorize chat messages', () => {
      assert.strictEqual(MESSAGE_CATEGORIES['chat_message'], 'chat');
      assert.strictEqual(MESSAGE_CATEGORIES['private_message'], 'chat');
    });

    it('should categorize reaction messages', () => {
      assert.strictEqual(MESSAGE_CATEGORIES['add_reaction'], 'reactions');
      assert.strictEqual(MESSAGE_CATEGORIES['remove_reaction'], 'reactions');
    });

    it('should categorize typing messages', () => {
      assert.strictEqual(MESSAGE_CATEGORIES['typing_indicator'], 'typing');
    });

    it('should categorize room join messages', () => {
      assert.strictEqual(MESSAGE_CATEGORIES['join_room'], 'roomJoins');
      assert.strictEqual(MESSAGE_CATEGORIES['join_battle'], 'roomJoins');
      assert.strictEqual(MESSAGE_CATEGORIES['join_node'], 'roomJoins');
    });
  });
});
