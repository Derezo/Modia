/**
 * Multiplayer Party API Integration Tests
 *
 * Tests the multiplayer party routes including:
 * - Party creation with correct enum values
 * - Party invites with correct column names (invite_status)
 * - Route ordering (invites before :partyId)
 * - Membership checks
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('Multiplayer Party API', () => {
  const ctx = createTestContext();
  let user1, user2, char1, char2;

  before(async () => {
    // Create two users with characters for party tests
    user1 = await ctx.createUser();
    user2 = await ctx.createUser();

    const charRes1 = await ctx.createCharacter(user1.accessToken);
    char1 = charRes1.id;

    const charRes2 = await ctx.createCharacter(user2.accessToken);
    char2 = charRes2.id;
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/party/multiplayer - Create party', () => {
    it('should create a party with default adventure type', async () => {
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Test Party'
      }, user1.accessToken);

      assert.strictEqual(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.party, 'Response should contain party');
      assert.strictEqual(res.body.party.partyType, 'adventure');
      assert.strictEqual(res.body.party.status, 'forming');
      assert.strictEqual(res.body.party.maxMembers, 4);

      // Clean up: disband the party by leaving
      if (res.body.party.id) {
        await request('POST', `/api/party/multiplayer/${res.body.party.id}/leave`, {}, user1.accessToken);
      }
    });

    it('should accept legacy pve party type and map to adventure', async () => {
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Legacy Party',
        partyType: 'pve'
      }, user1.accessToken);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.party.partyType, 'adventure');

      // Clean up
      if (res.body.party.id) {
        await request('POST', `/api/party/multiplayer/${res.body.party.id}/leave`, {}, user1.accessToken);
      }
    });

    it('should reject invalid party type', async () => {
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Bad Party',
        partyType: 'invalid_type'
      }, user1.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid party type'));
    });

    it('should reject invalid maxMembers', async () => {
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Test Party',
        maxMembers: 1
      }, user1.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('maxMembers must be between 2 and 8'));
    });

    it('should reject maxMembers > 8', async () => {
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Test Party',
        maxMembers: 10
      }, user1.accessToken);

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/party/multiplayer/invites - Route ordering', () => {
    it('should return invites list (not be shadowed by :partyId route)', async () => {
      const res = await request('GET', '/api/party/multiplayer/invites', null, user1.accessToken);

      // The key test: this should return 200 with invites array, not a 500 integer parsing error
      assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(Array.isArray(res.body.invites), 'Response should contain invites array');
    });
  });

  describe('Party invite flow', () => {
    let partyId;

    before(async () => {
      // User1 creates a party
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Invite Test Party'
      }, user1.accessToken);

      assert.strictEqual(res.status, 201);
      partyId = res.body.party.id;
    });

    after(async () => {
      // Clean up party
      if (partyId) {
        await request('POST', `/api/party/multiplayer/${partyId}/leave`, {}, user1.accessToken);
      }
    });

    it('should send invite using correct invite_status column', async () => {
      // This tests that we use invite_status, not status column
      const res = await request('POST', `/api/party/multiplayer/${partyId}/invite`, {
        username: user2.username
      }, user1.accessToken);

      assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.invite, 'Response should contain invite');
      assert.ok(res.body.invite.id, 'Invite should have an ID');

      // Verify the invite was created with correct status
      const inviteCheck = await query(
        'SELECT invite_status FROM party_invites WHERE id = $1',
        [res.body.invite.id]
      );
      assert.strictEqual(inviteCheck.rows[0].invite_status, 'pending');
    });

    it('should list pending invites for target user', async () => {
      const res = await request('GET', '/api/party/multiplayer/invites', null, user2.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.invites.length > 0, 'Should have at least one invite');
    });

    it('should accept invite and join party', async () => {
      // Get pending invite
      const invitesRes = await request('GET', '/api/party/multiplayer/invites', null, user2.accessToken);
      const invite = invitesRes.body.invites.find(i => i.party_id === partyId);
      assert.ok(invite, 'Should find the pending invite');

      // Accept the invite
      const joinRes = await request('POST', `/api/party/multiplayer/join/${invite.id}`, {}, user2.accessToken);

      assert.strictEqual(joinRes.status, 200, `Expected 200 but got ${joinRes.status}: ${JSON.stringify(joinRes.body)}`);
      assert.ok(joinRes.body.party, 'Response should contain party');
      assert.ok(joinRes.body.party.members.length >= 2, 'Party should have at least 2 members');

      // Verify invite status was updated
      const inviteCheck = await query(
        'SELECT invite_status FROM party_invites WHERE id = $1',
        [invite.id]
      );
      assert.strictEqual(inviteCheck.rows[0].invite_status, 'accepted');

      // Leaving removes the member and ends their access to the party
      const leaveRes = await request('POST', `/api/party/multiplayer/${partyId}/leave`, {}, user2.accessToken);
      assert.strictEqual(leaveRes.status, 200, JSON.stringify(leaveRes.body));
      const membership = await query(
        'SELECT 1 FROM party_members WHERE party_id = $1 AND user_id = $2',
        [partyId, user2.userId]
      );
      assert.strictEqual(membership.rows.length, 0);
      const afterLeave = await request('GET', `/api/party/multiplayer/${partyId}`, null, user2.accessToken);
      assert.strictEqual(afterLeave.status, 404);
    });

    it('should decline invite with correct status update', async () => {
      // Create a new invite
      await request('POST', `/api/party/multiplayer/${partyId}/invite`, {
        username: user2.username
      }, user1.accessToken);

      // Get pending invite
      const invitesRes = await request('GET', '/api/party/multiplayer/invites', null, user2.accessToken);
      const invite = invitesRes.body.invites.find(i => i.party_id === partyId);
      assert.ok(invite, 'Should find the pending invite');

      // Decline the invite
      const declineRes = await request('POST', `/api/party/multiplayer/decline/${invite.id}`, {}, user2.accessToken);

      assert.strictEqual(declineRes.status, 200);

      // Verify invite status was updated
      const inviteCheck = await query(
        'SELECT invite_status FROM party_invites WHERE id = $1',
        [invite.id]
      );
      assert.strictEqual(inviteCheck.rows[0].invite_status, 'declined');
    });
  });

  describe('GET /api/party/multiplayer/:partyId - Membership check', () => {
    let partyId;

    before(async () => {
      // User1 creates a party
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Private Party'
      }, user1.accessToken);

      assert.strictEqual(res.status, 201);
      partyId = res.body.party.id;
    });

    after(async () => {
      if (partyId) {
        await request('POST', `/api/party/multiplayer/${partyId}/leave`, {}, user1.accessToken);
      }
    });

    it('should return party details for member', async () => {
      const res = await request('GET', `/api/party/multiplayer/${partyId}`, null, user1.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.party);
    });

    it('should return 404 for non-member (not expose party to outsiders)', async () => {
      const res = await request('GET', `/api/party/multiplayer/${partyId}`, null, user2.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should return 400 for invalid party ID', async () => {
      const res = await request('GET', '/api/party/multiplayer/abc', null, user1.accessToken);

      assert.strictEqual(res.status, 400);
    });
  });

  describe('Ready status protection', () => {
    let partyId;

    before(async () => {
      const res = await request('POST', '/api/party/multiplayer', {
        name: 'Ready Test Party'
      }, user1.accessToken);

      partyId = res.body.party.id;
    });

    after(async () => {
      if (partyId) {
        await request('POST', `/api/party/multiplayer/${partyId}/leave`, {}, user1.accessToken);
      }
    });

    it('should allow ready toggle when forming', async () => {
      const res = await request('PUT', `/api/party/multiplayer/${partyId}/ready`, {
        isReady: true
      }, user1.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.isReady, true);
    });
  });

  describe('Privacy settings - allowPartyInvites', () => {
    let partyLeader, privateUser, partyId;

    before(async () => {
      partyLeader = await ctx.createUser();
      privateUser = await ctx.createUser();
    });

    after(async () => {
      // Clean up any party
      if (partyId) {
        await request('POST', `/api/party/multiplayer/${partyId}/leave`, {}, partyLeader.accessToken);
      }
    });

    it('should reject party invite when allowPartyInvites=false with 403', async () => {
      // Set privacy setting
      const settingsRes = await request('PUT', '/api/settings', {
        social: { allowPartyInvites: false }
      }, privateUser.accessToken);
      assert.strictEqual(settingsRes.status, 200, `Settings update failed: ${JSON.stringify(settingsRes.body)}`);
      assert.strictEqual(settingsRes.body.settings.social.allowPartyInvites, false);

      // Leader creates a party
      const partyRes = await request('POST', '/api/party/multiplayer', {
        name: 'Invite Test Party'
      }, partyLeader.accessToken);
      assert.strictEqual(partyRes.status, 201);
      partyId = partyRes.body.party.id;

      // Try to invite the private user - should get 403
      const inviteRes = await request('POST', `/api/party/multiplayer/${partyId}/invite`, {
        username: privateUser.username
      }, partyLeader.accessToken);

      assert.strictEqual(inviteRes.status, 403, `Expected 403 but got ${inviteRes.status}: ${JSON.stringify(inviteRes.body)}`);
      assert.ok(inviteRes.body.error.includes('not accepting party invitations'), inviteRes.body.error);
    });

    it('should allow party invite when allowPartyInvites=true', async () => {
      // Set privacy setting to allow
      const settingsRes = await request('PUT', '/api/settings', {
        social: { allowPartyInvites: true }
      }, privateUser.accessToken);
      assert.strictEqual(settingsRes.status, 200);

      // Try to invite - should succeed
      const inviteRes = await request('POST', `/api/party/multiplayer/${partyId}/invite`, {
        username: privateUser.username
      }, partyLeader.accessToken);

      assert.strictEqual(inviteRes.status, 200, `Expected 200 but got ${inviteRes.status}: ${JSON.stringify(inviteRes.body)}`);
      assert.ok(inviteRes.body.invite, 'Should have invite object');
    });
  });

  describe('Concurrent joins', () => {
    const cleanups = [];

    after(async () => {
      for (const fn of cleanups.reverse()) {
        await fn().catch(() => {});
      }
    });

    async function createParty(leader, maxMembers) {
      const res = await request('POST', '/api/party/multiplayer', { name: 'Race Party', maxMembers }, leader.accessToken);
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const id = res.body.party.id;
      cleanups.push(() => query('DELETE FROM parties WHERE id = $1', [id]));
      return id;
    }

    async function invite(partyId, leader, invitee) {
      const res = await request('POST', `/api/party/multiplayer/${partyId}/invite`, { username: invitee.username }, leader.accessToken);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      return res.body.invite.id;
    }

    it('two invitees racing for the last slot: exactly one joins', async () => {
      const leader = await ctx.createUser();
      const a = await ctx.createUser();
      const b = await ctx.createUser();
      const partyId = await createParty(leader, 2);
      const inviteA = await invite(partyId, leader, a);
      const inviteB = await invite(partyId, leader, b);

      const results = await Promise.all([
        request('POST', `/api/party/multiplayer/join/${inviteA}`, {}, a.accessToken),
        request('POST', `/api/party/multiplayer/join/${inviteB}`, {}, b.accessToken)
      ]);

      assert.deepStrictEqual(results.map(r => r.status).sort(), [200, 400], JSON.stringify(results.map(r => r.body)));
      const members = await query('SELECT COUNT(*)::int AS n FROM party_members WHERE party_id = $1', [partyId]);
      assert.strictEqual(members.rows[0].n, 2);
    });

    it('one user accepting two invites at once joins exactly one party', async () => {
      const leaderA = await ctx.createUser();
      const leaderB = await ctx.createUser();
      const joiner = await ctx.createUser();
      const partyA = await createParty(leaderA, 4);
      const partyB = await createParty(leaderB, 4);
      const inviteA = await invite(partyA, leaderA, joiner);
      const inviteB = await invite(partyB, leaderB, joiner);

      const results = await Promise.all([
        request('POST', `/api/party/multiplayer/join/${inviteA}`, {}, joiner.accessToken),
        request('POST', `/api/party/multiplayer/join/${inviteB}`, {}, joiner.accessToken)
      ]);

      assert.deepStrictEqual(results.map(r => r.status).sort(), [200, 400], JSON.stringify(results.map(r => r.body)));
      const memberships = await query(
        'SELECT party_id FROM party_members WHERE user_id = $1 AND party_id = ANY($2::int[])',
        [joiner.userId, [partyA, partyB]]
      );
      assert.strictEqual(memberships.rows.length, 1);
    });

    it('a replayed accept of the same invite is refused', async () => {
      const leader = await ctx.createUser();
      const joiner = await ctx.createUser();
      const partyId = await createParty(leader, 4);
      const inviteId = await invite(partyId, leader, joiner);

      const results = await Promise.all([
        request('POST', `/api/party/multiplayer/join/${inviteId}`, {}, joiner.accessToken),
        request('POST', `/api/party/multiplayer/join/${inviteId}`, {}, joiner.accessToken)
      ]);
      assert.deepStrictEqual(results.map(r => r.status).sort(), [200, 400]);
      const members = await query('SELECT COUNT(*)::int AS n FROM party_members WHERE party_id = $1 AND user_id = $2', [partyId, joiner.userId]);
      assert.strictEqual(members.rows[0].n, 1);
    });
  });
});

