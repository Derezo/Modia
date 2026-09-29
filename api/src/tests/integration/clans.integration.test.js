/**
 * Clans Integration Tests
 *
 * Tests clan functionality including:
 * - Leadership transfer (success, non-leader 403, non-member 404)
 * - Clan capacity (acceptInvite returning 409 when full)
 * - Basic CRUD operations
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('Clans API', () => {
  const ctx = createTestContext();
  let leader, member, outsider;

  before(async () => {
    leader = await ctx.createUser();
    member = await ctx.createUser();
    outsider = await ctx.createUser();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('Leadership transfer', () => {
    let clanId;

    afterEach(async () => {
      // Clean up clan after each test
      if (clanId) {
        await query('DELETE FROM clans WHERE id = $1', [clanId]);
        clanId = null;
      }
    });

    it('should transfer leadership successfully', async () => {
      // Leader creates a clan
      const createRes = await request('POST', '/api/clans', {
        name: 'Transfer Test Clan',
        tag: 'TTC1'
      }, leader.accessToken);
      assert.strictEqual(createRes.status, 201);
      clanId = createRes.body.clan.id;

      // Leader invites member
      const inviteRes = await request('POST', `/api/clans/${clanId}/invite/${member.username}`, {}, leader.accessToken);
      assert.strictEqual(inviteRes.status, 201);
      const inviteId = inviteRes.body.invite.id;

      // Member accepts invite
      const acceptRes = await request('POST', `/api/clans/invite/${inviteId}/accept`, {}, member.accessToken);
      assert.strictEqual(acceptRes.status, 200);

      // Leader transfers leadership to member
      const transferRes = await request('POST', `/api/clans/${clanId}/transfer`, {
        userId: member.userId
      }, leader.accessToken);

      assert.strictEqual(transferRes.status, 200, `Expected 200 but got ${transferRes.status}: ${JSON.stringify(transferRes.body)}`);
      assert.strictEqual(transferRes.body.success, true);
      assert.strictEqual(transferRes.body.newLeaderId, member.userId);
      assert.strictEqual(transferRes.body.newLeaderUsername, member.username);

      // Verify old leader can now leave (they are demoted to officer)
      const leaveRes = await request('POST', `/api/clans/${clanId}/leave`, {}, leader.accessToken);
      assert.strictEqual(leaveRes.status, 200, `Old leader should be able to leave after transfer: ${JSON.stringify(leaveRes.body)}`);
    });

    it('should reject transfer by non-leader with 403', async () => {
      // Leader creates a clan
      const createRes = await request('POST', '/api/clans', {
        name: 'Non-Leader Transfer Test',
        tag: 'NLT1'
      }, leader.accessToken);
      assert.strictEqual(createRes.status, 201);
      clanId = createRes.body.clan.id;

      // Leader invites member
      const inviteRes = await request('POST', `/api/clans/${clanId}/invite/${member.username}`, {}, leader.accessToken);
      assert.strictEqual(inviteRes.status, 201);
      const inviteId = inviteRes.body.invite.id;

      // Member accepts invite
      const acceptRes = await request('POST', `/api/clans/invite/${inviteId}/accept`, {}, member.accessToken);
      assert.strictEqual(acceptRes.status, 200);

      // Member (non-leader) tries to transfer - should get 403
      const transferRes = await request('POST', `/api/clans/${clanId}/transfer`, {
        userId: leader.userId
      }, member.accessToken);

      assert.strictEqual(transferRes.status, 403, `Expected 403 but got ${transferRes.status}: ${JSON.stringify(transferRes.body)}`);
      assert.ok(transferRes.body.error.includes('leader'), transferRes.body.error);
    });

    it('should reject transfer to non-member with 404', async () => {
      // Leader creates a clan
      const createRes = await request('POST', '/api/clans', {
        name: 'Non-Member Transfer Test',
        tag: 'NMT1'
      }, leader.accessToken);
      assert.strictEqual(createRes.status, 201);
      clanId = createRes.body.clan.id;

      // Leader tries to transfer to outsider (not a member) - should get 404
      const transferRes = await request('POST', `/api/clans/${clanId}/transfer`, {
        userId: outsider.userId
      }, leader.accessToken);

      assert.strictEqual(transferRes.status, 404, `Expected 404 but got ${transferRes.status}: ${JSON.stringify(transferRes.body)}`);
      assert.ok(transferRes.body.error.includes('not a member'), transferRes.body.error);
    });
  });

  describe('Clan capacity (max_members)', () => {
    let clanId;

    afterEach(async () => {
      // Clean up clan after each test
      if (clanId) {
        await query('DELETE FROM clans WHERE id = $1', [clanId]);
        clanId = null;
      }
    });

    it('should reject acceptInvite with 409 when clan is at max_members', async () => {
      // Leader creates a clan
      const createRes = await request('POST', '/api/clans', {
        name: 'Full Clan Test',
        tag: 'FULL'
      }, leader.accessToken);
      assert.strictEqual(createRes.status, 201);
      clanId = createRes.body.clan.id;

      // Leader invites outsider
      const inviteRes = await request('POST', `/api/clans/${clanId}/invite/${outsider.username}`, {}, leader.accessToken);
      assert.strictEqual(inviteRes.status, 201);
      const inviteId = inviteRes.body.invite.id;

      // Get current member count
      const memberCountRes = await query(
        'SELECT COUNT(*) as count FROM clan_members WHERE clan_id = $1',
        [clanId]
      );
      const currentCount = parseInt(memberCountRes.rows[0].count, 10);

      // Set max_members to current count (clan is now "full")
      await query('UPDATE clans SET max_members = $1 WHERE id = $2', [currentCount, clanId]);

      // Outsider tries to accept - should get 409 "Clan is full"
      const acceptRes = await request('POST', `/api/clans/invite/${inviteId}/accept`, {}, outsider.accessToken);

      assert.strictEqual(acceptRes.status, 409, `Expected 409 but got ${acceptRes.status}: ${JSON.stringify(acceptRes.body)}`);
      assert.ok(acceptRes.body.error.toLowerCase().includes('full'), acceptRes.body.error);
    });

    it('should allow acceptInvite when under max_members', async () => {
      // Leader creates a clan
      const createRes = await request('POST', '/api/clans', {
        name: 'Open Clan Test',
        tag: 'OPEN'
      }, leader.accessToken);
      assert.strictEqual(createRes.status, 201);
      clanId = createRes.body.clan.id;

      // Leader invites member
      const inviteRes = await request('POST', `/api/clans/${clanId}/invite/${member.username}`, {}, leader.accessToken);
      assert.strictEqual(inviteRes.status, 201);
      const inviteId = inviteRes.body.invite.id;

      // Member accepts - should succeed (default max_members is higher than 1)
      const acceptRes = await request('POST', `/api/clans/invite/${inviteId}/accept`, {}, member.accessToken);

      assert.strictEqual(acceptRes.status, 200, `Expected 200 but got ${acceptRes.status}: ${JSON.stringify(acceptRes.body)}`);
      assert.ok(acceptRes.body.membership, 'Should have membership object');
    });
  });
});
