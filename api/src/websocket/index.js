/**
 * @module WebSocketServer
 * @description Core WebSocket server setup and message handling for Modia MMORPG.
 *
 * Key responsibilities:
 * - WebSocket server initialization and connection handling
 * - Authentication with JWT tokens (10-second timeout)
 * - Message routing to appropriate handlers
 * - Connection lifecycle management (heartbeat, cleanup)
 * - Single connection per user enforcement
 *
 * @see rateLimiter.js - Rate limiting implementation
 * @see roomManager.js - Room subscription management
 * @see messageHandlers.js - Individual message type handlers
 */

import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../config/jwt.js';
import presenceService from '../services/presenceService.js';
import coliseumService from '../services/coliseumService.js';
import * as partyWebsocket from '../services/partyWebsocket.js';
import * as marketplaceWebsocket from '../services/marketplaceWebsocket.js';
import * as garrisonWebsocket from './garrisonWebsocket.js';
import { cleanupConnection } from '../services/messageReliability.js';

// Import extracted modules
import { checkRateLimit, cleanupUserRateLimits } from './rateLimiter.js';
import {
  connections,
  rooms,
  setConnection,
  removeConnection,
  removeUserFromAllRooms,
  isUserOnline,
  getOnlineCount,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange
} from './roomManager.js';

// Import message handlers
import {
  handleChatMessage,
  handlePrivateMessage,
  handleTypingIndicator,
  handleAddReaction,
  handleRemoveReaction,
  handleJoinRoom,
  handleLeaveRoom,
  handleColiseumQueueJoin,
  handleColiseumQueueLeave,
  handleColiseumReady,
  handleColiseumLobbyJoin,
  handleColiseumLobbyLeave,
  handleJoinBattle,
  handleLeaveBattle,
  handleBattleSyncRequest,
  handleAckMessage,
  handleBattleSurrender,
  handlePartyInvite,
  handlePartyInviteAccept,
  handlePartyInviteDecline,
  handlePartyLeave,
  handleJoinNode,
  handleLeaveNode,
  handleMarketplaceSubscribe,
  handleMarketplaceUnsubscribe,
  handleJoinGarrison,
  handleLeaveGarrison,
  handleGenerationCancel,
  handleGenerationCancelAll,
  handleGenerationPause,
  handleGenerationResume,
  handleAudioCancel,
  handleAudioCancelAll,
  handleAudioPause,
  handleAudioResume,
  handlePresenceUpdate
} from './messageHandlers.js';

// ============================================================
// Heartbeat Tracking
// ============================================================

const lastHeartbeat = new Map(); // userId -> timestamp
const HEARTBEAT_TIMEOUT_MS = 45000; // Close zombie connections after 45s

// ============================================================
// WebSocket Server Setup
// ============================================================

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Initialize marketplace WebSocket service with server references
  marketplaceWebsocket.initialize(wss, rooms, connections);

  // Authentication timeout duration (10 seconds)
  const AUTH_TIMEOUT_MS = 10000;

  wss.on('connection', (ws) => {
    let userId = null;
    let username = null;

    ws.isAlive = true;

    // SECURITY: Set authentication timeout
    const authTimeout = setTimeout(() => {
      if (!userId) {
        ws.send(JSON.stringify({
          type: 'auth_timeout',
          payload: { message: 'Authentication required within 10 seconds' }
        }));
        ws.close(1008, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        const { type, payload } = message;

        // Rate limit check (skip for auth)
        if (userId && type !== 'auth') {
          const rateCheck = await checkRateLimit(userId, type);
          if (rateCheck.limited) {
            ws.send(JSON.stringify({
              type: 'rate_limited',
              payload: {
                message: 'Too many messages. Please slow down.',
                category: rateCheck.category,
                retryAfter: rateCheck.retryAfter
              }
            }));
            return;
          }
        }

        switch (type) {
          case 'auth':
            handleAuth(ws, payload, authTimeout, (id, name) => {
              userId = id;
              username = name;
            });
            break;

          case 'join_room':
            await handleJoinRoom(ws, userId, username, payload);
            break;

          case 'leave_room':
            handleLeaveRoom(ws, userId, payload);
            break;

          case 'chat_message':
            await handleChatMessage(ws, userId, username, payload);
            break;

          case 'private_message':
            await handlePrivateMessage(ws, userId, username, payload);
            break;

          case 'typing_indicator':
            handleTypingIndicator(ws, userId, username, payload);
            break;

          case 'add_reaction':
            await handleAddReaction(ws, userId, username, payload);
            break;

          case 'remove_reaction':
            await handleRemoveReaction(ws, userId, payload);
            break;

          case 'coliseum_queue_join':
            await handleColiseumQueueJoin(ws, userId, username, payload);
            break;

          case 'coliseum_queue_leave':
            await handleColiseumQueueLeave(userId, payload);
            break;

          case 'coliseum_ready':
            await handleColiseumReady(ws, userId, payload);
            break;

          case 'coliseum_lobby_join':
            handleColiseumLobbyJoin(userId);
            break;

          case 'coliseum_lobby_leave':
            handleColiseumLobbyLeave(userId);
            break;

          case 'join_battle':
            await handleJoinBattle(ws, userId, payload);
            break;

          case 'leave_battle':
            handleLeaveBattle(userId, payload);
            break;

          case 'battle:surrender':
            await handleBattleSurrender(ws, userId, payload);
            break;

          case 'party_invite':
            await handlePartyInvite(ws, userId, username, payload);
            break;

          case 'party_invite_accept':
            await handlePartyInviteAccept(ws, userId, username, payload);
            break;

          case 'party_invite_decline':
            await handlePartyInviteDecline(ws, userId, payload);
            break;

          case 'party_leave':
            handlePartyLeave(ws, userId);
            break;

          case 'join_node':
            await handleJoinNode(ws, userId, username, payload);
            break;

          case 'leave_node':
            handleLeaveNode(userId, username, payload);
            break;

          case 'marketplace_subscribe':
            handleMarketplaceSubscribe(ws, userId, payload);
            break;

          case 'marketplace_unsubscribe':
            handleMarketplaceUnsubscribe(ws, userId, payload);
            break;

          case 'join_garrison':
            await handleJoinGarrison(ws, userId, payload);
            break;

          case 'leave_garrison':
            handleLeaveGarrison(ws, userId, payload);
            break;

          case 'presence_update':
            await handlePresenceUpdate(ws, userId, username, payload, broadcastPresenceChange);
            break;

          case 'generation:cancel':
            handleGenerationCancel(ws, userId, payload);
            break;

          case 'generation:cancel_all':
            handleGenerationCancelAll(ws, userId);
            break;

          case 'generation:pause':
            handleGenerationPause(ws, userId);
            break;

          case 'generation:resume':
            handleGenerationResume(ws, userId);
            break;

          case 'audio:cancel':
            handleAudioCancel(ws, userId, payload);
            break;

          case 'audio:cancel_all':
            handleAudioCancelAll(ws, userId);
            break;

          case 'audio:pause':
            handleAudioPause(ws, userId);
            break;

          case 'audio:resume':
            handleAudioResume(ws, userId);
            break;

          case 'ack':
            handleAckMessage(userId, message);
            break;

          case 'heartbeat':
            handleHeartbeat(ws, userId, payload);
            break;

          case 'battle:request_sync':
            await handleBattleSyncRequest(ws, userId, payload);
            break;

          default:
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: 'Unknown message type' }
            }));
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid message format' }
        }));
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      handleDisconnect(userId, username);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  // Heartbeat to detect dead connections (server-side ping/pong)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Zombie connection cleanup based on client heartbeats
  const heartbeatCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [connId, lastTime] of lastHeartbeat) {
      if (now - lastTime > HEARTBEAT_TIMEOUT_MS) {
        const ws = connections.get(connId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log(`[WebSocket] Closing zombie connection: userId=${connId}`);
          ws.close(1000, 'Heartbeat timeout');
        }
        lastHeartbeat.delete(connId);
      }
    }
  }, 15000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(heartbeatCleanupInterval);
  });

  return wss;
}

// ============================================================
// Authentication Handler
// ============================================================

function handleAuth(ws, payload, authTimeout, setCredentials) {
  try {
    // DEV ONLY: Special admin token
    if (payload.token === 'dev_admin_token' && process.env.NODE_ENV !== 'production') {
      const userId = -999;
      const username = 'admin_dashboard';
      setCredentials(userId, username);
      setConnection(userId, ws);
      lastHeartbeat.set(userId, Date.now());
      clearTimeout(authTimeout);

      ws.send(JSON.stringify({
        type: 'auth_success',
        payload: { userId, username, isAdmin: true }
      }));
      return;
    }

    const decoded = verifyAccessToken(payload.token);
    const userId = decoded.userId;
    const username = decoded.username;

    // SECURITY: Limit to 1 connection per user
    const existingConnection = connections.get(userId);
    if (existingConnection && existingConnection !== ws && existingConnection.readyState === WebSocket.OPEN) {
      existingConnection.send(JSON.stringify({
        type: 'session_replaced',
        payload: { message: 'Another session has connected' }
      }));
      existingConnection.close(1000, 'Session replaced by new connection');
    }

    setCredentials(userId, username);
    setConnection(userId, ws);
    lastHeartbeat.set(userId, Date.now());
    clearTimeout(authTimeout);

    presenceService.setPresence(userId, 'online').catch(err => {
      console.error('Failed to set presence:', err);
    });

    broadcastPresenceChange(userId, username, 'online');

    ws.send(JSON.stringify({
      type: 'auth_success',
      payload: { userId, username }
    }));
  } catch {
    ws.send(JSON.stringify({
      type: 'auth_error',
      payload: { message: 'Invalid token' }
    }));
  }
}

// ============================================================
// Heartbeat Handler
// ============================================================

function handleHeartbeat(ws, userId, payload) {
  if (!userId) return;
  lastHeartbeat.set(userId, Date.now());

  ws.send(JSON.stringify({
    type: 'heartbeat_ack',
    timestamp: payload?.timestamp ?? Date.now(),
    id: payload?.id,
    serverTime: Date.now()
  }));
}

// ============================================================
// Disconnect Handler
// ============================================================

function handleDisconnect(userId, username) {
  if (!userId) return;

  removeConnection(userId);
  lastHeartbeat.delete(userId);
  cleanupConnection(userId);
  cleanupUserRateLimits(userId);

  presenceService.setOffline(userId).catch(err => {
    console.error('Failed to set offline:', err);
  });

  const removedNodes = presenceService.clearUserFromAllNodes(userId);
  removedNodes.forEach(nodeId => {
    const nodeRoom = `node:${nodeId}`;
    if (rooms.has(nodeRoom)) {
      broadcastToRoom(nodeRoom, {
        type: 'player:left_node',
        payload: {
          nodeId,
          userId,
          username,
          reason: 'disconnected',
          timestamp: Date.now()
        }
      });
    }
  });

  coliseumService.cleanupPlayer(userId);
  partyWebsocket.cleanupUserInvites(userId);
  marketplaceWebsocket.cleanupUserSubscriptions(userId);
  garrisonWebsocket.cleanupUserGarrisonSubscriptions(userId, rooms);

  broadcastPresenceChange(userId, username, 'offline');

  removeUserFromAllRooms(userId, (roomName) => {
    broadcastToRoom(roomName, {
      type: 'user_left',
      payload: { room: roomName, userId }
    });
  });
}

// Re-export garrison broadcast functions
const { broadcastGarrisonPurchase, broadcastGarrisonRefresh } = garrisonWebsocket;

export {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms,
  broadcastGarrisonPurchase,
  broadcastGarrisonRefresh
};

export default {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms,
  broadcastGarrisonPurchase,
  broadcastGarrisonRefresh
};
