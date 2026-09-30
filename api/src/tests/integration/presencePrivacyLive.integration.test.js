/**
 * Presence privacy — live server checks
 *
 * Users who set social.showOnlineStatus=false must not leak their presence:
 * - no presence_changed broadcast on connect or on presence_update
 * - no player:entered_node / player:left_node broadcast into node rooms
 * - excluded from getPlayersAtNodeWithPrivacy lists (except their own view)
 *
 * A visible control user runs the same steps, so a missing event for the
 * hidden user means suppression rather than a broken harness.
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
import presenceService from '../../services/presenceService.js';

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

function send(client, type, payload) {
  client.ws.send(JSON.stringify({ type, payload }));
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

function aboutUser(userId, type) {
  return m => m.type === type && Number(m.payload?.userId) === Number(userId);
}

describe('presence privacy (live)', () => {
  const ctx = createTestContext();
  let observer;
  let visible;
  let hidden;
  let nodeId;
  const clients = [];

  before(async () => {
    observer = await ctx.createUser();
    visible = await ctx.createUser();
    hidden = await ctx.createUser();
    await ctx.createCharacter(observer.accessToken);
    await ctx.createCharacter(visible.accessToken);
    await ctx.createCharacter(hidden.accessToken);

    // Start nodes depend on race; co-locate everyone on the observer's node
    // so node-room access checks pass for all three.
    const start = await query(
      'SELECT current_node_id FROM characters WHERE user_id = $1 AND party_slot = 1',
      [observer.userId]
    );
    nodeId = start.rows[0].current_node_id;
    await query(
      `UPDATE characters SET current_node_id = $1
       WHERE user_id = ANY($2::int[]) AND party_slot IS NOT NULL`,
      [nodeId, [visible.userId, hidden.userId]]
    );

    const res = await request('PUT', '/api/settings', {
      social: { showOnlineStatus: false }
    }, hidden.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.social.showOnlineStatus, false);
  });

  after(async () => {
    for (const client of clients) {
      client.ws.close();
    }
    presenceService.clearUserFromAllNodes(visible?.userId);
    presenceService.clearUserFromAllNodes(hidden?.userId);
    await delay(100);
    await ctx.cleanup();
  });

  it('suppresses connect, presence_update and node enter/leave for hidden users', async () => {
    const obs = await openClient(observer.accessToken);
    clients.push(obs);
    send(obs, 'join_room', { room: 'global' });
    send(obs, 'join_node', { nodeId });
    await waitFor(obs, m => m.type === 'node_room_joined');

    // Control: the visible user is announced on every path.
    const vis = await openClient(visible.accessToken);
    clients.push(vis);
    await waitFor(obs, m => aboutUser(visible.userId, 'presence_changed')(m)
      && m.payload.status === 'online');
    send(vis, 'join_node', { nodeId });
    await waitFor(obs, aboutUser(visible.userId, 'player:entered_node'));
    send(vis, 'presence_update', { status: 'away' });
    await waitFor(obs, m => aboutUser(visible.userId, 'presence_changed')(m)
      && m.payload.status === 'away');
    send(vis, 'leave_node', { nodeId });
    await waitFor(obs, aboutUser(visible.userId, 'player:left_node'));

    // Hidden user: same steps, nothing reaches the observer.
    const hid = await openClient(hidden.accessToken);
    clients.push(hid);
    send(hid, 'join_node', { nodeId });
    await waitFor(hid, m => m.type === 'node_room_joined');
    send(hid, 'presence_update', { status: 'busy' });
    await waitFor(hid, m => m.type === 'presence_updated');
    send(hid, 'leave_node', { nodeId });
    await delay(QUIET_MS);

    const leaked = obs.messages.filter(
      m => Number(m.payload?.userId) === Number(hidden.userId)
    );
    assert.deepEqual(leaked, [], 'hidden user presence must not be broadcast');
  });

  it('filters hidden users from node player lists except for themselves', async () => {
    presenceService.enterNode(nodeId, visible.userId, visible.username, 'Vis');
    presenceService.enterNode(nodeId, hidden.userId, hidden.username, 'Hid');

    const forObserver = await presenceService.getPlayersAtNodeWithPrivacy(
      nodeId,
      { requesterId: observer.userId }
    );
    const ids = forObserver.map(p => Number(p.userId));
    assert.ok(ids.includes(Number(visible.userId)));
    assert.ok(!ids.includes(Number(hidden.userId)));

    const forHidden = await presenceService.getPlayersAtNodeWithPrivacy(
      nodeId,
      { requesterId: hidden.userId }
    );
    assert.ok(forHidden.some(p => Number(p.userId) === Number(hidden.userId)));
  });

  it('GET /world/nodes/:id/players serves the privacy-filtered list', async () => {
    const res = await request(
      'GET',
      `/api/world/nodes/${nodeId}/players`,
      null,
      observer.accessToken
    );
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.players));
    assert.ok(
      !res.body.players.some(p => Number(p.userId) === Number(hidden.userId))
    );
  });

  it('a hidden user who travels to a node is not listed there for others', async () => {
    const neighbor = await query(
      `SELECT CASE WHEN from_node_id = $1 THEN to_node_id ELSE from_node_id END AS id
       FROM world_node_connections
       WHERE from_node_id = $1 OR to_node_id = $1
       ORDER BY id
       LIMIT 1`,
      [nodeId]
    );
    assert.equal(neighbor.rows.length, 1, 'start node must have a neighbour');
    const targetId = neighbor.rows[0].id;

    for (const user of [visible, hidden]) {
      await query(
        `INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
         VALUES ($1, $2, 'travel')
         ON CONFLICT (user_id, node_id) DO UPDATE SET discovery_method = 'travel'`,
        [user.userId, targetId]
      );
      const travel = await request(
        'POST',
        '/api/world/travel',
        { targetNodeId: targetId },
        user.accessToken
      );
      assert.equal(travel.status, 200, JSON.stringify(travel.body));
      // The traveller always sees themselves in the travel response
      assert.ok(travel.body.playersAtNode.some(
        p => Number(p.userId) === Number(user.userId)
      ));
    }

    const res = await request(
      'GET',
      `/api/world/nodes/${targetId}/players`,
      null,
      observer.accessToken
    );
    assert.equal(res.status, 200);
    const ids = res.body.players.map(p => Number(p.userId));
    // Control: the visible traveller is listed, so the list is live
    assert.ok(ids.includes(Number(visible.userId)), 'visible user must be listed');
    assert.ok(!ids.includes(Number(hidden.userId)), 'hidden user must not be listed');

    const own = await request(
      'GET',
      `/api/world/nodes/${targetId}/players`,
      null,
      hidden.accessToken
    );
    assert.equal(own.status, 200);
    assert.ok(own.body.players.some(p => Number(p.userId) === Number(hidden.userId)));
  });

  it('a hidden user joining and leaving global is not announced or listed', async () => {
    const obs = await openClient(observer.accessToken);
    clients.push(obs);
    send(obs, 'join_room', { room: 'global' });
    await waitFor(obs, m => m.type === 'room_joined' && m.payload.room === 'global');

    // Control: the visible user's join, membership and leave reach the observer
    const vis = await openClient(visible.accessToken);
    clients.push(vis);
    send(vis, 'join_room', { room: 'global' });
    await waitFor(obs, aboutUser(visible.userId, 'user_joined'));
    const visJoined = await waitFor(vis, m => m.type === 'room_joined' && m.payload.room === 'global');
    assert.ok(visJoined.payload.users.map(Number).includes(Number(observer.userId)));

    const hid = await openClient(hidden.accessToken);
    clients.push(hid);
    send(hid, 'join_room', { room: 'global' });
    const hidJoined = await waitFor(hid, m => m.type === 'room_joined' && m.payload.room === 'global');
    // The hidden user sees themselves in their own list
    assert.ok(hidJoined.payload.users.map(Number).includes(Number(hidden.userId)));

    // A later joiner does not see the hidden user in the member list (a
    // separate user: a second socket for 'visible' would replace its session)
    const lateUser = await ctx.createUser();
    const late = await openClient(lateUser.accessToken);
    clients.push(late);
    send(late, 'join_room', { room: 'global' });
    const lateJoined = await waitFor(late, m => m.type === 'room_joined' && m.payload.room === 'global');
    assert.ok(!lateJoined.payload.users.map(Number).includes(Number(hidden.userId)));

    send(hid, 'leave_room', { room: 'global' });
    await waitFor(hid, m => m.type === 'room_left');
    send(vis, 'leave_room', { room: 'global' });
    await waitFor(obs, aboutUser(visible.userId, 'user_left'));
    await delay(QUIET_MS);

    const leaked = obs.messages.filter(
      m => (m.type === 'user_joined' || m.type === 'user_left') && Number(m.payload?.userId) === Number(hidden.userId)
    );
    assert.deepEqual(leaked, [], 'hidden user join/leave must not be broadcast');
  });
});

