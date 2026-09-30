/**
 * Social WebSocket notifications — live server checks
 *
 * - A REST party invite reaches the invitee over WS with the DB invite id
 * - Declining an invite sends party:invite_declined to the inviter
 * - Accepting an expired invite sends party:invite_expired to the invitee
 * - A user who has been blocked cannot DM the blocker (error, no delivery)
 * - Chat history serves only global and per-party rooms
 * - Reactions (REST and WS) validate the emoji and require message visibility
 * - WS presence_update validates customMessage, can clear it, echoes the stored value
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import {
  BASE_URL,
  createTestContext,
  request,
  query
} from '../testHelper.js';

const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/ws`;
const QUIET_MS = 400;

function openClient(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages = [];
    ws.on('message', raw => {
      try {
        messages.push(JSON.parse(raw.toString()));
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
    });
    const started = Date.now();
    const poll = setInterval(() => {
      if (messages.some(m => m.type === 'auth_success')) {
        clearInterval(poll);
        resolve({ ws, messages });
      } else if (Date.now() - started > 5000) {
        clearInterval(poll);
        reject(new Error('auth_success not received'));
      }
    }, 20);
  });
}

function waitFor(client, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const found = client.messages.find(predicate);
      if (found) {
        clearInterval(poll);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        reject(new Error('expected message not received'));
      }
    }, 20);
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('social websocket notifications (live)', () => {
  const ctx = createTestContext();
  const clients = [];
  const createdMessageIds = [];
  let leader;
  let invitee;
  let partyId;

  async function connect(user) {
    const client = await openClient(user.accessToken);
    clients.push(client);
    return client;
  }

  async function invite() {
    const res = await request('POST', `/api/party/multiplayer/${partyId}/invite`, {
      username: invitee.username
    }, leader.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.invite.id;
  }

  before(async () => {
    leader = await ctx.createUser();
    invitee = await ctx.createUser();
    await ctx.createCharacter(leader.accessToken);
    await ctx.createCharacter(invitee.accessToken);

    const created = await request('POST', '/api/party/multiplayer', {
      name: 'Socket Party'
    }, leader.accessToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    partyId = created.body.party.id;
  });

  after(async () => {
    for (const client of clients) client.ws.close();
    await delay(100);
    if (createdMessageIds.length > 0) {
      await query('DELETE FROM chat_reactions WHERE message_id = ANY($1)', [createdMessageIds]);
      await query('DELETE FROM chat_messages WHERE id = ANY($1)', [createdMessageIds]);
    }
    await ctx.cleanup();
  });

  it('delivers the invite over WS with the DB invite id, and tells the inviter on decline', async () => {
    const leaderWs = await connect(leader);
    const inviteeWs = await connect(invitee);

    const inviteId = await invite();
    const received = await waitFor(inviteeWs, m => m.type === 'party:invite_received');
    assert.equal(received.payload.inviteId, inviteId);
    const row = await query('SELECT invitee_id FROM party_invites WHERE id = $1', [inviteId]);
    assert.equal(row.rows[0].invitee_id, invitee.userId);

    const declined = await request(
      'POST', `/api/party/multiplayer/decline/${inviteId}`, null, invitee.accessToken
    );
    assert.equal(declined.status, 200, JSON.stringify(declined.body));
    const notice = await waitFor(leaderWs, m => m.type === 'party:invite_declined');
    assert.equal(notice.payload.inviteId, inviteId);
    assert.equal(notice.payload.userId, invitee.userId);
  });

  it('sends party:invite_expired when an expired invite is accepted', async () => {
    const inviteeWs = await connect(invitee);
    const inviteId = await invite();
    await query(
      "UPDATE party_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
      [inviteId]
    );

    const join = await request(
      'POST', `/api/party/multiplayer/join/${inviteId}`, null, invitee.accessToken
    );
    assert.equal(join.status, 400);
    const expired = await waitFor(
      inviteeWs,
      m => m.type === 'party:invite_expired' && m.payload.inviteId === inviteId
    );
    assert.equal(expired.payload.partyId, partyId);
  });

  it('refuses a DM from a blocked user to the blocker and delivers nothing', async () => {
    const sender = await ctx.createUser();
    const blocker = await ctx.createUser();
    const senderChar = await ctx.createCharacter(sender.accessToken);
    await ctx.createCharacter(blocker.accessToken);

    const blocked = await request(
      'POST', `/api/friends/${sender.userId}/block`, null, blocker.accessToken
    );
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));

    const senderWs = await connect(sender);
    const blockerWs = await connect(blocker);
    senderWs.ws.send(JSON.stringify({
      type: 'private_message',
      payload: {
        targetUserId: blocker.userId,
        message: 'test message to blocker',
        characterId: senderChar.id
      }
    }));

    const error = await waitFor(senderWs, m => m.type === 'error');
    assert.equal(error.payload.message, 'Cannot message this user');
    await delay(QUIET_MS);
    assert.equal(
      blockerWs.messages.some(m => m.type === 'private_message_received'),
      false
    );
    assert.equal(
      senderWs.messages.some(m => m.type === 'private_message_sent'),
      false
    );
    const stored = await query(
      "SELECT COUNT(*)::int AS n FROM chat_messages WHERE room_type = 'dm' AND sender_user_id = $1",
      [sender.userId]
    );
    assert.equal(stored.rows[0].n, 0);
  });

  it('serves chat history only for global and a named party', async () => {
    const local = await request('GET', '/api/chat/history/local', null, leader.accessToken);
    assert.equal(local.status, 400);
    const partyNoId = await request('GET', '/api/chat/history/party', null, leader.accessToken);
    assert.equal(partyNoId.status, 400);
    const party = await request(
      'GET', `/api/chat/history/party?partyId=${partyId}`, null, leader.accessToken
    );
    assert.equal(party.status, 200, JSON.stringify(party.body));
  });

  it('limits reactions to valid emoji on messages the user can see', async () => {
    const author = await ctx.createUser();
    const recipient = await ctx.createUser();
    const outsider = await ctx.createUser();
    const authorChar = await ctx.createCharacter(author.accessToken);
    const dm = await query(
      `INSERT INTO chat_messages (character_id, sender_user_id, room_type, message, target_user_id)
       VALUES ($1, $2, 'dm', 'test private note', $3) RETURNING id`,
      [authorChar.id, author.userId, recipient.userId]
    );
    const messageId = dm.rows[0].id;
    createdMessageIds.push(messageId);
    const thumbsUp = String.fromCodePoint(0x1F44D);

    const hidden = await request('POST', '/api/chat/reaction', { messageId, emoji: thumbsUp }, outsider.accessToken);
    assert.equal(hidden.status, 404, JSON.stringify(hidden.body));
    const hiddenRemove = await request('DELETE', '/api/chat/reaction', { messageId, emoji: thumbsUp }, outsider.accessToken);
    assert.equal(hiddenRemove.status, 404, JSON.stringify(hiddenRemove.body));

    const allowed = await request('POST', '/api/chat/reaction', { messageId, emoji: thumbsUp }, recipient.accessToken);
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(allowed.body.reactions[0].emoji, thumbsUp);

    const outsiderWs = await connect(outsider);
    outsiderWs.ws.send(JSON.stringify({ type: 'add_reaction', payload: { messageId, emoji: thumbsUp } }));
    const wsHidden = await waitFor(outsiderWs, m => m.type === 'error');
    assert.equal(wsHidden.payload.message, 'Message not found');

    const recipientWs = await connect(recipient);
    recipientWs.ws.send(JSON.stringify({
      type: 'add_reaction',
      payload: { messageId, emoji: 'not an emoji at all' }
    }));
    const wsInvalid = await waitFor(recipientWs, m => m.type === 'error');
    assert.equal(wsInvalid.payload.message, 'Invalid emoji format');

    const stored = await query(
      'SELECT emoji, user_id FROM chat_reactions WHERE message_id = $1',
      [messageId]
    );
    assert.deepEqual(stored.rows.map(r => [r.emoji, r.user_id]), [[thumbsUp, recipient.userId]]);
  });

  it('validates, sets and clears the presence customMessage over WS', async () => {
    const user = await ctx.createUser();
    const client = await connect(user);
    const updates = () => client.messages.filter(m => m.type === 'presence_updated');

    client.ws.send(JSON.stringify({ type: 'presence_update', payload: { status: 'away', customMessage: 123 } }));
    const invalid = await waitFor(client, m => m.type === 'error');
    assert.equal(invalid.payload.message, 'customMessage must be a string');

    client.ws.send(JSON.stringify({ type: 'presence_update', payload: { status: 'away', customMessage: '  Fishing  ' } }));
    await waitFor(client, () => updates().length >= 1);
    assert.equal(updates()[0].payload.customMessage, 'Fishing');

    client.ws.send(JSON.stringify({ type: 'presence_update', payload: { status: 'online', customMessage: null } }));
    await waitFor(client, () => updates().length >= 2);
    assert.equal(updates()[1].payload.customMessage, null);
    const stored = await query('SELECT custom_message FROM player_presence WHERE user_id = $1', [user.userId]);
    assert.equal(stored.rows[0].custom_message, null);
  });
});
