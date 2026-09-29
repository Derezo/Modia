/**
 * Friends Blocking Integration Tests
 *
 * Tests the friend blocking functionality including:
 * - Block independence (B blocking A doesn't erase A's block on B)
 * - Blocked users can't send friend requests
 * - Block/unblock flow
 * - Privacy settings (allowFriendRequests, showOnlineStatus)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('Friends Block API', () => {
  const ctx = createTestContext();
  // Use separate user pairs for each describe block to avoid parallel test interference
  let userA1, userB1;  // Block independence tests
  let userA2, userB2;  // Block listing tests
  let userA3, userB3;  // Unblock tests
  let userA4, userB4;  // Friend search tests

  before(async () => {
    userA1 = await ctx.createUser();
    userB1 = await ctx.createUser();
    userA2 = await ctx.createUser();
    userB2 = await ctx.createUser();
    userA3 = await ctx.createUser();
    userB3 = await ctx.createUser();
    userA4 = await ctx.createUser();
    userB4 = await ctx.createUser();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('Block independence', () => {
    beforeEach(async () => {
      // Clean slate for each test - uses userA1/userB1
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userA1.userId]);
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userB1.userId]);
    });

    it('should allow A to block B', async () => {
      const res = await request('POST', `/api/friends/${userB1.userId}/block`, {}, userA1.accessToken);

      assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);

      // Verify block exists
      const blockCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userA1.userId, userB1.userId]
      );
      assert.strictEqual(blockCheck.rows[0].status, 'blocked');
    });

    it('should not erase A\'s block when B blocks A back', async () => {
      // A blocks B
      await request('POST', `/api/friends/${userB1.userId}/block`, {}, userA1.accessToken);

      // Verify A's block exists
      const beforeCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userA1.userId, userB1.userId]
      );
      assert.strictEqual(beforeCheck.rows.length, 1, 'A should have blocked B');
      assert.strictEqual(beforeCheck.rows[0].status, 'blocked');

      // B blocks A
      await request('POST', `/api/friends/${userA1.userId}/block`, {}, userB1.accessToken);

      // Verify A's block STILL exists (the bug was that B blocking A erased A's block)
      const afterCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userA1.userId, userB1.userId]
      );
      assert.strictEqual(afterCheck.rows.length, 1, 'A\'s block on B should still exist');
      assert.strictEqual(afterCheck.rows[0].status, 'blocked');

      // Verify B's block also exists
      const bBlockCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userB1.userId, userA1.userId]
      );
      assert.strictEqual(bBlockCheck.rows.length, 1, 'B should have blocked A');
      assert.strictEqual(bBlockCheck.rows[0].status, 'blocked');
    });

    it('should not erase A\'s block when B unblocks A', async () => {
      // A blocks B
      await request('POST', `/api/friends/${userB1.userId}/block`, {}, userA1.accessToken);

      // B blocks A
      await request('POST', `/api/friends/${userA1.userId}/block`, {}, userB1.accessToken);

      // B unblocks A - use null body for DELETE (empty object causes 400)
      const unblockRes = await request('DELETE', `/api/friends/${userA1.userId}/block`, null, userB1.accessToken);
      assert.strictEqual(unblockRes.status, 200, `Unblock should succeed but got ${unblockRes.status}: ${JSON.stringify(unblockRes.body)}`);

      // A's block on B should STILL exist
      const afterCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userA1.userId, userB1.userId]
      );
      assert.strictEqual(afterCheck.rows.length, 1, 'A\'s block on B should still exist after B unblocks A');
      assert.strictEqual(afterCheck.rows[0].status, 'blocked');

      // B's block on A should be gone
      const bBlockCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userB1.userId, userA1.userId]
      );
      assert.strictEqual(bBlockCheck.rows.length, 0, 'B\'s block on A should be removed');

      // After A unblocks, B's friend request to A should still be rejected (A's block persists)
      const friendReqRes = await request('POST', `/api/friends/request/${userA1.username}`, {}, userB1.accessToken);
      assert.strictEqual(friendReqRes.status, 400, 'Friend request from B to A should be rejected due to A\'s block');
    });

    it('should reject friend request from blocked user', async () => {
      // A blocks B
      await request('POST', `/api/friends/${userB1.userId}/block`, {}, userA1.accessToken);

      // B tries to send friend request to A (route is POST /request/:username)
      const res = await request('POST', `/api/friends/request/${userA1.username}`, {}, userB1.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Cannot send friend request'), res.body.error);
    });
  });

  describe('Block listing', () => {
    before(async () => {
      // Uses userA2/userB2
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userA2.userId]);
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userB2.userId]);
      // A blocks B
      await request('POST', `/api/friends/${userB2.userId}/block`, {}, userA2.accessToken);
    });

    it('should list blocked users', async () => {
      const res = await request('GET', '/api/friends/blocked', null, userA2.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.blocked), 'Response should contain blocked array');
      assert.ok(res.body.blocked.some(b => b.blockedUserId === userB2.userId), 'Should include blocked user');
    });
  });

  describe('Unblock', () => {
    it('should unblock a user', async () => {
      // Uses userA3/userB3
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userA3.userId]);
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userB3.userId]);

      // Ensure A has B blocked
      const blockRes = await request('POST', `/api/friends/${userB3.userId}/block`, {}, userA3.accessToken);
      assert.strictEqual(blockRes.status, 200, `Block failed: ${JSON.stringify(blockRes.body)}`);

      const res = await request('DELETE', `/api/friends/${userB3.userId}/block`, null, userA3.accessToken);

      assert.strictEqual(res.status, 200, `Unblock failed: ${JSON.stringify(res.body)}`);

      // Verify block is removed
      const blockCheck = await query(
        'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = \'blocked\'',
        [userA3.userId, userB3.userId]
      );
      assert.strictEqual(blockCheck.rows.length, 0, 'Block should be removed');
    });
  });

  describe('Friend search - no duplicates', () => {
    it('should not return duplicate friends in search results', async () => {
      // Uses userA4/userB4
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userA4.userId]);
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userB4.userId]);

      // Create a friendship (A sends request - route is POST /request/:username)
      const reqRes = await request('POST', `/api/friends/request/${userB4.username}`, {}, userA4.accessToken);
      assert.strictEqual(reqRes.status, 201, `Friend request failed: ${JSON.stringify(reqRes.body)}`);

      // Get the pending request for B
      const pendingRes = await request('GET', '/api/friends/requests', null, userB4.accessToken);
      assert.strictEqual(pendingRes.status, 200, `Get requests failed: ${JSON.stringify(pendingRes.body)}`);

      const pendingRequest = pendingRes.body.requests.find(r => r.fromUserId === userA4.userId);
      assert.ok(pendingRequest, `No pending request found from userA. Requests: ${JSON.stringify(pendingRes.body.requests)}`);

      // B accepts the request (route is POST /accept/:requestId)
      const acceptRes = await request('POST', `/api/friends/accept/${pendingRequest.requestId}`, {}, userB4.accessToken);
      assert.strictEqual(acceptRes.status, 200, `Accept failed: ${JSON.stringify(acceptRes.body)}`);

      // Now search for the friend - should appear only once
      const searchRes = await request('GET', `/api/friends/search?q=${userA4.username}`, null, userB4.accessToken);

      assert.strictEqual(searchRes.status, 200);

      // Count how many times userA appears
      const matches = searchRes.body.players.filter(p => p.id === userA4.userId);
      assert.strictEqual(matches.length, 1, `User should appear exactly once but appeared ${matches.length} times`);
    });
  });

  describe('Privacy settings - allowFriendRequests', () => {
    let userWithPrivacy, userSender;

    before(async () => {
      userWithPrivacy = await ctx.createUser();
      userSender = await ctx.createUser();
    });

    beforeEach(async () => {
      // Clean slate
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userWithPrivacy.userId]);
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userSender.userId]);
    });

    it('should reject friend request when allowFriendRequests=false with 403', async () => {
      // Set privacy setting
      const settingsRes = await request('PUT', '/api/settings', {
        social: { allowFriendRequests: false }
      }, userWithPrivacy.accessToken);
      assert.strictEqual(settingsRes.status, 200, `Settings update failed: ${JSON.stringify(settingsRes.body)}`);

      // Verify setting was applied
      assert.strictEqual(settingsRes.body.settings.social.allowFriendRequests, false);

      // Try to send friend request - should get 403
      const friendReqRes = await request('POST', `/api/friends/request/${userWithPrivacy.username}`, {}, userSender.accessToken);

      assert.strictEqual(friendReqRes.status, 403, `Expected 403 but got ${friendReqRes.status}: ${JSON.stringify(friendReqRes.body)}`);
      assert.ok(friendReqRes.body.error.includes('not accepting friend requests'), friendReqRes.body.error);
    });

    it('should allow friend request when allowFriendRequests=true', async () => {
      // Ensure setting is enabled (default)
      const settingsRes = await request('PUT', '/api/settings', {
        social: { allowFriendRequests: true }
      }, userWithPrivacy.accessToken);
      assert.strictEqual(settingsRes.status, 200);

      // Try to send friend request - should succeed
      const friendReqRes = await request('POST', `/api/friends/request/${userWithPrivacy.username}`, {}, userSender.accessToken);

      assert.strictEqual(friendReqRes.status, 201, `Expected 201 but got ${friendReqRes.status}: ${JSON.stringify(friendReqRes.body)}`);
    });
  });

  describe('Privacy settings - showOnlineStatus', () => {
    let userHidden, userViewer;

    before(async () => {
      userHidden = await ctx.createUser();
      userViewer = await ctx.createUser();

      // Clean slate and create friendship
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userHidden.userId]);
      await query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userViewer.userId]);

      // Create a friendship so we can test getFriends
      const reqRes = await request('POST', `/api/friends/request/${userViewer.username}`, {}, userHidden.accessToken);
      assert.strictEqual(reqRes.status, 201);

      const pendingRes = await request('GET', '/api/friends/requests', null, userViewer.accessToken);
      const pendingReq = pendingRes.body.requests.find(r => r.fromUserId === userHidden.userId);
      assert.ok(pendingReq);

      await request('POST', `/api/friends/accept/${pendingReq.requestId}`, {}, userViewer.accessToken);
    });

    it('should mask status/currentNodeId in getFriends when showOnlineStatus=false', async () => {
      // Set userHidden to hide online status
      const settingsRes = await request('PUT', '/api/settings', {
        social: { showOnlineStatus: false }
      }, userHidden.accessToken);
      assert.strictEqual(settingsRes.status, 200);

      // Get friends as the viewer
      const friendsRes = await request('GET', '/api/friends', null, userViewer.accessToken);
      assert.strictEqual(friendsRes.status, 200);

      const hiddenFriend = friendsRes.body.friends.find(f => f.friendId === userHidden.userId);
      assert.ok(hiddenFriend, 'Hidden user should be in friends list');

      // Status should be masked
      assert.strictEqual(hiddenFriend.status, 'offline', 'Status should be masked to offline');
      assert.strictEqual(hiddenFriend.online, false, 'online should be false');
      assert.strictEqual(hiddenFriend.customMessage, null, 'customMessage should be null');
      assert.strictEqual(hiddenFriend.currentNodeId, null, 'currentNodeId should be null');
    });

    it('should show status when showOnlineStatus=true', async () => {
      // Set userHidden to show online status
      const settingsRes = await request('PUT', '/api/settings', {
        social: { showOnlineStatus: true }
      }, userHidden.accessToken);
      assert.strictEqual(settingsRes.status, 200);

      // Get friends as the viewer - status should not be forced offline
      const friendsRes = await request('GET', '/api/friends', null, userViewer.accessToken);
      assert.strictEqual(friendsRes.status, 200);

      const hiddenFriend = friendsRes.body.friends.find(f => f.friendId === userHidden.userId);
      assert.ok(hiddenFriend, 'Hidden user should be in friends list');

      // Status should reflect actual presence (might be offline but not forced)
      // The key test is that this doesn't throw and the fields are allowed to be non-null
      assert.ok(['online', 'offline', 'away', 'busy'].includes(hiddenFriend.status));
    });
  });
});
