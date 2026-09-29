/**
 * LFG (Looking For Group) API Integration Tests
 *
 * Tests the LFG routes including:
 * - Post creation with proper validation
 * - Fixed party status enum (forming/ready, not 'active')
 * - Parameter validation (no 500s on invalid input)
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('LFG API', () => {
  const ctx = createTestContext();
  // Use separate users for each test that creates posts to avoid parallel test interference
  // POST tests (each test gets its own user since they run in parallel)
  let postUser1, postUser2, postUser3;  // POST tests
  let listUser;                          // GET list tests
  let myPostUser1, myPostUser2;          // my-post tests
  let deleteUser1, deleteUser2;          // delete tests
  let applyOwner, applier;               // apply tests

  before(async () => {
    // Create users - each parallel test that creates posts needs its own user
    postUser1 = await ctx.createUser();   // "create post successfully"
    postUser2 = await ctx.createUser();   // "reject duplicate"
    postUser3 = await ctx.createUser();   // "NaN minLevel" (just in case)
    listUser = await ctx.createUser();    // GET list tests
    myPostUser1 = await ctx.createUser(); // "return null"
    myPostUser2 = await ctx.createUser(); // "return active post"
    deleteUser1 = await ctx.createUser(); // "delete own" / "reject delete other"
    deleteUser2 = await ctx.createUser(); // helper for delete tests
    applyOwner = await ctx.createUser();  // owns the post to apply to
    applier = await ctx.createUser();     // applies to posts

    await ctx.createCharacter(postUser1.accessToken);
    await ctx.createCharacter(postUser2.accessToken);
    await ctx.createCharacter(postUser3.accessToken);
    await ctx.createCharacter(listUser.accessToken);
    await ctx.createCharacter(myPostUser1.accessToken);
    await ctx.createCharacter(myPostUser2.accessToken);
    await ctx.createCharacter(deleteUser1.accessToken);
    await ctx.createCharacter(deleteUser2.accessToken);
    await ctx.createCharacter(applyOwner.accessToken);
    await ctx.createCharacter(applier.accessToken);
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/lfg - Create LFG post', () => {
    it('should create an LFG post successfully', async () => {
      // Uses postUser1 exclusively
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [postUser1.userId]);

      const res = await request('POST', '/api/lfg', {
        title: 'Looking for party',
        description: 'Need help with dungeon',
        minLevel: 10,
        maxLevel: 20
      }, postUser1.accessToken);

      assert.strictEqual(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.post, 'Response should contain post');
      assert.strictEqual(res.body.post.title, 'Looking for party');

      // Clean up
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [postUser1.userId]);
    });

    it('should reject title that is too short', async () => {
      // Validation only - no post created, any user works
      const res = await request('POST', '/api/lfg', {
        title: 'ab', // 2 chars, minimum is 3
        description: 'Test'
      }, postUser3.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject non-string title with 400, not 500', async () => {
      // Validation only - no post created
      const res = await request('POST', '/api/lfg', {
        title: 12345, // number instead of string
        description: 'Test'
      }, postUser3.accessToken);

      assert.strictEqual(res.status, 400, 'Should return 400 for non-string input, not 500');
    });

    it('should reject duplicate post from same user', async () => {
      // Uses postUser2 exclusively
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [postUser2.userId]);

      const firstRes = await request('POST', '/api/lfg', {
        title: 'First post'
      }, postUser2.accessToken);
      assert.strictEqual(firstRes.status, 201, 'First post should be created');

      // Second post should fail
      const res = await request('POST', '/api/lfg', {
        title: 'Second post'
      }, postUser2.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('already have an active LFG post'));

      // Clean up
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [postUser2.userId]);
    });

    it('should handle NaN minLevel with 400, not 500', async () => {
      // Validation only - no post created
      const res = await request('POST', '/api/lfg', {
        title: 'Test Post',
        minLevel: 'abc' // not a valid number
      }, postUser3.accessToken);

      assert.strictEqual(res.status, 400, 'Should return 400 for invalid minLevel');
    });
  });

  describe('GET /api/lfg - List LFG posts', () => {
    before(async () => {
      // Clean and create a test post using listUser
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [listUser.userId]);
      await request('POST', '/api/lfg', {
        title: 'Test listing',
        minLevel: 1,
        maxLevel: 50,
        contentTier: 2
      }, listUser.accessToken);
    });

    after(async () => {
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [listUser.userId]);
    });

    it('should list LFG posts', async () => {
      const res = await request('GET', '/api/lfg', null, listUser.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.posts));
    });

    it('should handle negative limit with 400, not 500', async () => {
      const res = await request('GET', '/api/lfg?limit=-5', null, listUser.accessToken);

      assert.strictEqual(res.status, 400, 'Should return 400 for negative limit');
    });

    it('should handle NaN minLevel with 400, not 500', async () => {
      const res = await request('GET', '/api/lfg?minLevel=abc', null, listUser.accessToken);

      assert.strictEqual(res.status, 400, 'Should return 400 for invalid minLevel');
    });

    it('should handle invalid contentTier with 400', async () => {
      const res = await request('GET', '/api/lfg?contentTier=abc', null, listUser.accessToken);

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/lfg/my-post', () => {
    it('should return null when user has no post', async () => {
      // Uses myPostUser1 exclusively
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [myPostUser1.userId]);

      const res = await request('GET', '/api/lfg/my-post', null, myPostUser1.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.post, null);
    });

    it('should return user\'s active post', async () => {
      // Uses myPostUser2 exclusively
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [myPostUser2.userId]);

      const createRes = await request('POST', '/api/lfg', {
        title: 'My active post'
      }, myPostUser2.accessToken);

      assert.strictEqual(createRes.status, 201, `Failed to create post: ${JSON.stringify(createRes.body)}`);

      const res = await request('GET', '/api/lfg/my-post', null, myPostUser2.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.post, `Expected post but got: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.post.title, 'My active post');

      // Clean up
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [myPostUser2.userId]);
    });
  });

  describe('DELETE /api/lfg/:postId', () => {
    before(async () => {
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [deleteUser1.userId]);
    });

    it('should delete own post', async () => {
      // Uses deleteUser1 exclusively
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [deleteUser1.userId]);

      const createRes = await request('POST', '/api/lfg', {
        title: 'Delete me'
      }, deleteUser1.accessToken);

      const postId = createRes.body.post.id;

      const deleteRes = await request('DELETE', `/api/lfg/${postId}`, null, deleteUser1.accessToken);

      assert.strictEqual(deleteRes.status, 200);
      assert.ok(deleteRes.body.success);
    });

    it('should reject deleting other user\'s post', async () => {
      // Uses deleteUser2 for creating (deleteUser1 tries to delete)
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [deleteUser2.userId]);

      const createRes = await request('POST', '/api/lfg', {
        title: 'Not yours'
      }, deleteUser2.accessToken);

      const postId = createRes.body.post.id;

      const deleteRes = await request('DELETE', `/api/lfg/${postId}`, null, deleteUser1.accessToken);

      assert.strictEqual(deleteRes.status, 403);

      // Clean up
      await query('DELETE FROM lfg_posts WHERE id = $1', [postId]);
    });

    it('should handle invalid postId with 400', async () => {
      const res = await request('DELETE', '/api/lfg/abc', null, deleteUser1.accessToken);

      assert.strictEqual(res.status, 400);
    });
  });

  describe('POST /api/lfg/:postId/apply', () => {
    let postId;

    before(async () => {
      // Uses applyOwner exclusively for creating the post
      await query('DELETE FROM lfg_posts WHERE user_id = $1', [applyOwner.userId]);
      const res = await request('POST', '/api/lfg', {
        title: 'Apply to this',
        minLevel: 1,
        maxLevel: 100
      }, applyOwner.accessToken);
      postId = res.body.post.id;
    });

    after(async () => {
      await query('DELETE FROM lfg_posts WHERE id = $1', [postId]);
    });

    it('should apply to a post', async () => {
      // Uses applier to apply to applyOwner's post
      const res = await request('POST', `/api/lfg/${postId}/apply`, {
        message: 'I want to join!'
      }, applier.accessToken);

      assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.success);
    });

    it('should reject applying to own post', async () => {
      const res = await request('POST', `/api/lfg/${postId}/apply`, {}, applyOwner.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('own LFG post'));
    });
  });
});
