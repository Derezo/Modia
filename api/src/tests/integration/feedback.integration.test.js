/**
 * Feedback API Integration Tests
 * Tests for user feedback submission and retrieval endpoints
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  request,
  createTestUser,
  createTestCharacter,
  cleanupTestUser,
  resetRateLimitersViaApi,
  query
} from '../testHelper.js';

describe('Feedback API', () => {
  let testUser = null;
  let testCharacter = null;
  let targetUser = null;
  let targetCharacter = null;
  let targetCharacterName = null;
  const createdUserIds = [];

  before(async () => {
    await resetRateLimitersViaApi();

    // Create primary test user and character
    testUser = await createTestUser();
    createdUserIds.push(testUser.userId);
    testCharacter = await createTestCharacter(testUser.accessToken);

    // Create a target user/character for abuse reports
    targetUser = await createTestUser();
    createdUserIds.push(targetUser.userId);
    targetCharacterName = `Abuse${Date.now().toString(36).slice(-8)}`;
    targetCharacter = await createTestCharacter(
      targetUser.accessToken,
      targetCharacterName
    );
  });

  after(async () => {
    // Clean up feedback records first (before users are deleted)
    for (const userId of createdUserIds) {
      try {
        await query('DELETE FROM user_feedback WHERE user_id = $1', [userId]);
      } catch (err) {
        // Ignore errors - user might already be deleted
      }
    }

    // Clean up users
    for (const userId of createdUserIds) {
      await cleanupTestUser(userId);
    }
  });

  describe('POST /api/feedback', () => {
    it('should create an enhancement request', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'enhancement',
        title: 'Add more character classes',
        description: 'It would be great to have more variety in character classes, like a ranger or paladin.'
      }, testUser.accessToken);

      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.feedback, 'Response should contain feedback object');
      assert.ok(res.body.feedback.id, 'Feedback should have an ID');
      assert.strictEqual(res.body.feedback.feedback_type, 'enhancement');
      assert.strictEqual(res.body.feedback.title, 'Add more character classes');
      assert.strictEqual(res.body.feedback.status, 'pending');
    });

    it('should create a bug report', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'bug',
        title: 'Battle UI glitch',
        description: 'When selecting a skill, the target highlight sometimes disappears.',
        characterId: testCharacter.id,
        gameContext: {
          scene: 'battle',
          battleId: 12345
        }
      }, testUser.accessToken);

      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.feedback, 'Response should contain feedback object');
      assert.strictEqual(res.body.feedback.feedback_type, 'bug');
      assert.strictEqual(res.body.feedback.character_id, testCharacter.id);
      assert.ok(res.body.feedback.game_context, 'Should include game context');
    });

    it('should create an abuse report with target', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'abuse',
        title: 'Harassment in chat',
        description: 'This player was sending inappropriate messages in global chat.',
        reportedCharacterName: targetCharacterName
      }, testUser.accessToken);

      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.feedback, 'Response should contain feedback object');
      assert.strictEqual(res.body.feedback.feedback_type, 'abuse');

      // Verify the reported character was looked up (check database directly)
      const dbResult = await query(
        'SELECT reported_user_id, reported_character_id FROM user_feedback WHERE id = $1',
        [res.body.feedback.id]
      );
      assert.strictEqual(dbResult.rows.length, 1);
      assert.strictEqual(dbResult.rows[0].reported_user_id, targetUser.userId);
      assert.strictEqual(dbResult.rows[0].reported_character_id, targetCharacter.id);
    });

    it('should reject without auth (401)', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'enhancement',
        title: 'Test title',
        description: 'Test description'
      });

      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    });

    it('should reject invalid feedback type', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'invalid_type',
        title: 'Test title',
        description: 'Test description'
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(
        res.body.error?.includes('Invalid feedback type') || res.body.message?.includes('Invalid feedback type'),
        'Error message should mention invalid feedback type'
      );
    });

    it('should reject oversized title (>200 chars)', async () => {
      const longTitle = 'x'.repeat(201);

      const res = await request('POST', '/api/feedback', {
        feedbackType: 'enhancement',
        title: longTitle,
        description: 'Test description'
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(
        res.body.error?.includes('200') || res.body.message?.includes('200'),
        'Error message should mention 200 character limit'
      );
    });

    it('should reject oversized description (>2000 chars)', async () => {
      const longDescription = 'y'.repeat(2001);

      const res = await request('POST', '/api/feedback', {
        feedbackType: 'bug',
        title: 'Valid title',
        description: longDescription
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(
        res.body.error?.includes('2000') || res.body.message?.includes('2000'),
        'Error message should mention 2000 character limit'
      );
    });

    it('should reject empty title', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'enhancement',
        title: '',
        description: 'Test description'
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(
        res.body.error?.includes('required') || res.body.message?.includes('required'),
        'Error message should mention title is required'
      );
    });

    it('should reject empty description', async () => {
      const res = await request('POST', '/api/feedback', {
        feedbackType: 'bug',
        title: 'Valid title',
        description: '   '
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(
        res.body.error?.includes('required') || res.body.message?.includes('required'),
        'Error message should mention description is required'
      );
    });
  });

  describe('GET /api/feedback/my', () => {
    it('should return user\'s own feedback', async () => {
      // First create some feedback
      await request('POST', '/api/feedback', {
        feedbackType: 'enhancement',
        title: 'Unique test feedback for retrieval',
        description: 'This is a test feedback item'
      }, testUser.accessToken);

      const res = await request('GET', '/api/feedback/my', null, testUser.accessToken);

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.ok(Array.isArray(res.body.feedback), 'Response should contain feedback array');
      assert.ok(res.body.feedback.length > 0, 'Should have at least one feedback item');

      // Check that we can find our test feedback
      const found = res.body.feedback.some(f => f.title === 'Unique test feedback for retrieval');
      assert.ok(found, 'Should find the feedback we just created');
    });

    it('should reject without auth (401)', async () => {
      const res = await request('GET', '/api/feedback/my');

      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    });

    it('should respect limit and offset parameters', async () => {
      // Get first page with limit 2
      const page1 = await request('GET', '/api/feedback/my?limit=2&offset=0', null, testUser.accessToken);

      assert.strictEqual(page1.status, 200);
      assert.ok(Array.isArray(page1.body.feedback));
      assert.ok(page1.body.feedback.length <= 2, 'Should respect limit parameter');

      // If there are more than 2 items, test offset
      if (page1.body.feedback.length === 2) {
        const page2 = await request('GET', '/api/feedback/my?limit=2&offset=2', null, testUser.accessToken);
        assert.strictEqual(page2.status, 200);
        assert.ok(Array.isArray(page2.body.feedback));

        // Items should be different (if there are enough)
        if (page2.body.feedback.length > 0) {
          assert.notStrictEqual(
            page1.body.feedback[0].id,
            page2.body.feedback[0].id,
            'Offset should return different items'
          );
        }
      }
    });

    it('should not return other user\'s feedback', async () => {
      // Create feedback as target user
      await request('POST', '/api/feedback', {
        feedbackType: 'enhancement',
        title: 'Target user feedback only',
        description: 'This should not be visible to other users'
      }, targetUser.accessToken);

      // Try to retrieve as test user
      const res = await request('GET', '/api/feedback/my', null, testUser.accessToken);

      assert.strictEqual(res.status, 200);
      const found = res.body.feedback.some(f => f.title === 'Target user feedback only');
      assert.ok(!found, 'Should not see other user\'s feedback');
    });
  });
});
